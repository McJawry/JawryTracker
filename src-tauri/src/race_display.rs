//! Serves the race stream display to OBS while this tracker hosts a race.
//!
//! A Browser Source pointed at `http://127.0.0.1:4747/?stream=1` gets the
//! app's own page, which reads which race to show from `/race.json` here and
//! then follows that runner on the relay by itself. The address never changes
//! between races, so a stream's OBS scenes are set up once.
//!
//! Started the first time a race is hosted and never before: a tracker used on
//! its own listens on no port. Plain `std::net` rather than a server crate -
//! it only ever answers a handful of GETs from the same machine.
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::Duration;
use tauri::AppHandle;

const PORT: u16 = 4747;

/// The race the display should follow, as `/race.json` serves it.
static RACE: Mutex<String> = Mutex::new(String::new());
static LISTENING: Mutex<bool> = Mutex::new(false);

/// Sets the race the display follows (`None` once it's over) and makes sure
/// the server is up. Returns the port, or why it couldn't listen.
#[tauri::command]
pub fn serve_race_display(app: AppHandle, race: Option<String>) -> Result<u16, String> {
    let hosting = race.is_some();
    *RACE.lock().unwrap() = race.unwrap_or_else(|| "null".into());

    let mut listening = LISTENING.lock().unwrap();
    // A race ending is no reason to start listening.
    if !*listening && hosting {
        // Loopback only: nothing outside this machine can reach it, and
        // Windows doesn't ask about the firewall.
        let listener = TcpListener::bind(("127.0.0.1", PORT))
            .map_err(|error| format!("port {PORT} is in use by another program ({error})"))?;
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = respond(&app, stream);
                });
            }
        });
        *listening = true;
    }
    Ok(PORT)
}

fn respond(app: &AppHandle, mut stream: TcpStream) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let mut reader = BufReader::new(stream.try_clone()?);

    let mut request_line = String::new();
    reader.read_line(&mut request_line)?;
    let mut host = String::new();
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
    }

    // Only requests made to this machine by name: a web page can't get at
    // the race by pointing a domain of its own at 127.0.0.1.
    if host != format!("127.0.0.1:{PORT}") && host != format!("localhost:{PORT}") {
        return send(&mut stream, "403 Forbidden", "text/plain", b"Forbidden", &[]);
    }

    let target = request_line.split_whitespace().nth(1).unwrap_or("/");
    let path = target.split(['?', '#']).next().unwrap_or("/");

    if path == "/race.json" {
        let race = RACE.lock().unwrap().clone();
        // Read cross-origin while developing, when the page itself comes
        // from the dev server.
        return send(
            &mut stream,
            "200 OK",
            "application/json",
            race.as_bytes(),
            &[("Access-Control-Allow-Origin", "*"), ("Cache-Control", "no-store")],
        );
    }

    // A dev build has no bundled pages to serve; the dev server has them.
    if tauri::is_dev() {
        if let Some(dev_url) = &app.config().build.dev_url {
            let location = dev_url.join(target).map(|url| url.to_string()).unwrap_or_default();
            return send(&mut stream, "302 Found", "text/plain", b"", &[("Location", &location)]);
        }
    }

    match app.asset_resolver().get(path.to_string()) {
        Some(asset) => send(&mut stream, "200 OK", &asset.mime_type, &asset.bytes, &[]),
        None => send(&mut stream, "404 Not Found", "text/plain", b"Not found", &[]),
    }
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
