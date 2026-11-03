//! Serves the stream display to OBS: each runner's items while this tracker
//! hosts a race, and this tracker's own items while the solo browser source is
//! turned on (Settings → General).
//!
//! A Browser Source pointed at `http://127.0.0.1:4747/?stream=1` gets the
//! app's own page, which reads which race to show from `/race.json` here and
//! then follows that runner on the relay by itself. `?stream=solo` reads this
//! tracker's run from `/solo.json` instead, which answers as soon as the run
//! changes: a request that finds nothing new waits for something to be. The
//! addresses never change, so a stream's OBS scenes are set up once.
//!
//! Listens only while there is something to show - a tracker used on its own,
//! without the solo browser source, listens on no port. Plain `std::net`
//! rather than a server crate: it only ever answers a handful of GETs from the
//! same machine.
use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::AppHandle;

const PORT: u16 = 4747;
/// How long a request for the solo run waits for it to change before answering anyway.
const SOLO_WAIT: Duration = Duration::from_secs(20);

/// The race the display should follow, as `/race.json` serves it.
static RACE: Mutex<Option<String>> = Mutex::new(None);

/// This tracker's run for the solo browser source, numbered so a request can
/// wait for the next one.
struct Solo {
    version: u64,
    run: Option<String>,
}
static SOLO: Mutex<Solo> = Mutex::new(Solo { version: 0, run: None });
static SOLO_CHANGED: Condvar = Condvar::new();

static LISTENER: Mutex<Option<JoinHandle<()>>> = Mutex::new(None);
static STOPPING: AtomicBool = AtomicBool::new(false);

/// Sets the race the display follows (`None` once it's over). Returns the
/// port, or why it couldn't listen.
#[tauri::command]
pub fn serve_race_display(app: AppHandle, race: Option<String>) -> Result<u16, String> {
    *RACE.lock().unwrap() = race;
    update_listening(app)
}

/// Sets this tracker's run for the solo browser source (`None` once it's
/// turned off). Returns the port, or why it couldn't listen.
#[tauri::command]
pub fn serve_solo_display(app: AppHandle, run: Option<String>) -> Result<u16, String> {
    {
        let mut solo = SOLO.lock().unwrap();
        solo.version += 1;
        solo.run = run;
    }
    SOLO_CHANGED.notify_all();
    update_listening(app)
}

/// Listens while there's a race or a solo run to show, and stops once there's neither.
fn update_listening(app: AppHandle) -> Result<u16, String> {
    let wanted = RACE.lock().unwrap().is_some() || SOLO.lock().unwrap().run.is_some();
    let mut listener = LISTENER.lock().unwrap();
    if wanted && listener.is_none() {
        // Loopback only: nothing outside this machine can reach it, and
        // Windows doesn't ask about the firewall.
        let socket = TcpListener::bind(("127.0.0.1", PORT))
            .map_err(|error| format!("port {PORT} is in use by another program ({error})"))?;
        STOPPING.store(false, Ordering::SeqCst);
        *listener = Some(std::thread::spawn(move || {
            for stream in socket.incoming() {
                if STOPPING.load(Ordering::SeqCst) {
                    break;
                }
                if let Ok(stream) = stream {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = respond(&app, stream);
                    });
                }
            }
        }));
    } else if !wanted {
        if let Some(handle) = listener.take() {
            STOPPING.store(true, Ordering::SeqCst);
            // The loop only looks between connections, so one wakes it - and
            // once it has let go of the port, it can be listened on again.
            let address = SocketAddr::from((Ipv4Addr::LOCALHOST, PORT));
            if TcpStream::connect_timeout(&address, Duration::from_secs(1)).is_ok() {
                let _ = handle.join();
            }
        }
    }
    Ok(PORT)
}

fn respond(app: &AppHandle, mut stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut host = String::new();
    // Kept for passing the request on to the dev server.
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line)? == 0 || line.trim_end().is_empty() {
            break;
        }
        if let Some((name, value)) = line.split_once(':') {
            if name.eq_ignore_ascii_case("host") {
                host = value.trim().to_string();
            }
        }
        headers.push(line);
    }

    // Only requests made to this machine by name: a web page can't get at
    // the race by pointing a domain of its own at 127.0.0.1.
    if host != format!("127.0.0.1:{PORT}") && host != format!("localhost:{PORT}") {
        return send(&mut stream, "403 Forbidden", "text/plain", b"Forbidden", &[]);
    }

    let target = request_line.split_whitespace().nth(1).unwrap_or("/");
    let path = target.split(['?', '#']).next().unwrap_or("/");
    // Readable cross-origin too: from a page on the dev server's own address,
    // say.
    let json_headers = [("Access-Control-Allow-Origin", "*"), ("Cache-Control", "no-store")];

    if path == "/race.json" {
        let race = RACE.lock().unwrap().clone().unwrap_or_else(|| "null".into());
        return send(&mut stream, "200 OK", "application/json", race.as_bytes(), &json_headers);
    }

    if path == "/solo.json" {
        // `?after=<version>`: the run the page already shows, so the answer
        // waits for a newer one.
        let after = target
            .split_once('?')
            .and_then(|(_, query)| query.split('&').find_map(|pair| pair.strip_prefix("after=")))
            .and_then(|version| version.parse::<u64>().ok());
        let mut solo = SOLO.lock().unwrap();
        if let Some(after) = after {
            solo = SOLO_CHANGED.wait_timeout_while(solo, SOLO_WAIT, |solo| solo.version == after).unwrap().0;
        }
        let body = format!("{{\"version\":{},\"run\":{}}}", solo.version, solo.run.as_deref().unwrap_or("null"));
        drop(solo);
        return send(&mut stream, "200 OK", "application/json", body.as_bytes(), &json_headers);
    }

    // A dev build has no bundled pages to serve; the dev server has them, and
    // they're passed on from here. It used to send OBS to the dev server's
    // own address instead, which OBS then reloaded the page from - so a
    // Browser Source stayed broken after switching to a built tracker, with
    // the dev server gone, until its address was entered again.
    if tauri::is_dev() {
        if let Some(dev_url) = &app.config().build.dev_url {
            return pass_to_dev_server(dev_url, &request_line, &headers, &mut stream);
        }
    }

    match app.asset_resolver().get(path.to_string()) {
        Some(asset) => send(&mut stream, "200 OK", &asset.mime_type, &asset.bytes, &[]),
        None => send(&mut stream, "404 Not Found", "text/plain", b"Not found", &[]),
    }
}

/// Passes a request on to the dev server, and its answer back byte for byte.
/// The page's live updates connect to the dev server directly - Vite falls
/// back to its own address when this one doesn't take its WebSocket.
fn pass_to_dev_server(dev_url: &tauri::Url, request_line: &str, headers: &[String], client: &mut TcpStream) -> std::io::Result<()> {
    let host = dev_url.host_str().unwrap_or("localhost");
    let port = dev_url.port_or_known_default().unwrap_or(80);
    let Ok(mut server) = TcpStream::connect((host, port)) else {
        return send(client, "502 Bad Gateway", "text/plain", b"The dev server isn't running", &[]);
    };
    server.set_read_timeout(Some(Duration::from_secs(30)))?;
    let mut head = format!("{}\r\nHost: {host}:{port}\r\nConnection: close\r\n", request_line.trim_end());
    for header in headers {
        let name = header.split(':').next().unwrap_or("").trim();
        if !name.eq_ignore_ascii_case("host") && !name.eq_ignore_ascii_case("connection") {
            head.push_str(header.trim_end());
            head.push_str("\r\n");
        }
    }
    head.push_str("\r\n");
    server.write_all(head.as_bytes())?;
    std::io::copy(&mut server, client)?;
    client.flush()
}

fn send(stream: &mut TcpStream, status: &str, mime: &str, body: &[u8], headers: &[(&str, &str)]) -> std::io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {mime}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    for (name, value) in headers {
        head.push_str(&format!("{name}: {value}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}
