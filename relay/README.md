# JawryTracker race relay

The server behind [Race Tracking](../README.md#race-tracking). It passes each runner's tracker
state on to the stream host, one room per race. It runs on Cloudflare Workers with Durable
Objects, which the free plan covers.

Trackers use a public copy by default. To run your own, for example for a tournament:

1. Install the tools: `npm install`
2. Sign in to a Cloudflare account: `npx wrangler login`
3. Deploy: `npm run deploy`. It prints the relay's address.
4. Check it works: `RELAY_URL=<that address> npm test`

Then enter the address under **Settings → Race Tracking → Relay server** in every tracker taking
part.

To try changes locally, `npm run dev` runs the relay on `http://127.0.0.1:8787`, and `npm test`
tests it there.

Rooms delete themselves two days after they're created.
