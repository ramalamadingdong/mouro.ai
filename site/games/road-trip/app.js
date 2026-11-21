// Road Trip games: the code shared by /games/road-trip/trivia/, /photo/ and
// /categories/. Each page sets <body data-game="..."> and carries only its own
// markup; the parts for other games are simply never wired up.
//
// PRIVACY RULE: a player's location must never be visible to anyone else.
// The position goes from the browser straight to OpenStreetMap (Nominatim,
// OSRM) and Wikimedia, and is kept only in memory. Nothing about places goes
// into localStorage (past games keep a date and a score) or to mouro.ai. The
// only thing that uses our realtime server is Categories (car screen +
// remotes), whose room holds the word game alone: letter, category, timer,
// names, scores. The rules in games/road-trip/ reject any other field. Never
// put a town, county, photo or position in a room.
//
// The map and photo services are free and keyless and ask for light use, so
// requests are queued per host and spaced out (Nominatim and OSRM at most one
// a second). Many players would need keyed or self-hosted services.

(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: play on without saving */ } },
  };
  const textOf = (html) => new DOMParser().parseFromString(html || "", "text/html").body.textContent.trim();

  // ── Polite fetching ─────────────────────────────────────────────────────
  // One queue per host, with a gap after each request. Nominatim and the OSRM
  // demo server both ask for no more than one request a second.
  const GAP = { "nominatim.openstreetmap.org": 1100, "router.project-osrm.org": 1100, "commons.wikimedia.org": 400, "query.wikidata.org": 1000 };
  const chains = {};
  function getJSON(url) {
    const host = new URL(url).host;
    const run = (chains[host] || Promise.resolve()).then(async () => {
      // A stuck request would hold up the whole queue for its host, so give up after 15 s.
      const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout?.(15000) });
      if (!res.ok) throw new Error(`${host} answered ${res.status}`);
      return res.json();
    });
    chains[host] = run.catch(() => {}).then(() => sleep(GAP[host] || 150));
    return run;
  }
  const qs = (o) => new URLSearchParams(o).toString();
  const NOMINATIM = "https://nominatim.openstreetmap.org";
  const WIKIDATA = "https://www.wikidata.org/w/api.php";

  // ── Geometry ([lon, lat] everywhere, like GeoJSON) ───────────────────────
  const rad = (d) => d * Math.PI / 180;
  function dist(a, b) {
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function projSeg(p, a, b) {
    const k = Math.cos(rad(p[1]));
    const dx = (b[0] - a[0]) * k, dy = b[1] - a[1];
    const L = dx * dx + dy * dy;
    let t = L ? (((p[0] - a[0]) * k) * dx + (p[1] - a[1]) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    return { t, d: dist(p, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]) };
  }

  // A route is the OSRM polyline plus running totals of time and distance.
  function makeRoute(osrm) {
    const r = osrm.routes[0];
    const coords = r.geometry.coordinates;
    const segDur = [], segDist = [];
    for (const leg of r.legs) { segDur.push(...leg.annotation.duration); segDist.push(...leg.annotation.distance); }
    const cumDur = [0], cumDist = [0];
    for (let i = 0; i < segDur.length; i++) { cumDur.push(cumDur[i] + segDur[i]); cumDist.push(cumDist[i] + segDist[i]); }
    return { coords, segDur, segDist, cumDur, cumDist, n: coords.length, duration: cumDur[cumDur.length - 1], distance: cumDist[cumDist.length - 1] };
  }
  // Nearest point on the route: search near the last match first, the whole route if that fails.
  function snap(route, p, hint = 0) {
    let best = { d: Infinity, i: 0, t: 0 };
    const scan = (lo, hi) => {
      for (let i = Math.max(0, lo); i <= Math.min(route.n - 2, hi); i++) {
        const r = projSeg(p, route.coords[i], route.coords[i + 1]);
        if (r.d < best.d) best = { d: r.d, i, t: r.t };
      }
    };
    scan(hint - 40, hint + 800);
    if (best.d > 300) scan(0, route.n - 2);
    best.time = route.cumDur[best.i] + route.segDur[best.i] * best.t;
    best.meters = route.cumDist[best.i] + route.segDist[best.i] * best.t;
    return best;
  }
  function pointAtTime(route, t) {
    t = Math.max(0, Math.min(route.duration, t));
    let lo = 0, hi = route.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (route.cumDur[m] <= t) lo = m; else hi = m; }
    const seg = route.segDur[lo] || 1, f = Math.min(1, (t - route.cumDur[lo]) / seg);
    const a = route.coords[lo], b = route.coords[Math.min(lo + 1, route.n - 1)];
    return { p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], i: lo };
  }

  // ── Services ────────────────────────────────────────────────────────────
  async function geocode(text) {
    const hits = await getJSON(`${NOMINATIM}/search?${qs({ q: text, format: "jsonv2", limit: 1, "accept-language": "en" })}`);
    if (!hits.length) throw new Error(`Couldn’t find “${text}”.`);
    return { p: [+hits[0].lon, +hits[0].lat], name: hits[0].name || text };
  }
  async function fetchRoute(from, to) {
    const url = `https://router.project-osrm.org/route/v1/driving/${from.join(",")};${to.join(",")}?${qs({ overview: "full", geometries: "geojson", annotations: "duration,distance" })}`;
    const data = await getJSON(url);
    if (data.code !== "Ok" || !data.routes?.length) throw new Error("No driving route between those places.");
    return makeRoute(data);
  }
  const reverse = (p, zoom) => getJSON(`${NOMINATIM}/reverse?${qs({ lat: p[1], lon: p[0], zoom, format: "jsonv2", extratags: 1, addressdetails: 1, "accept-language": "en" })}`);
  function myPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("This browser can’t share its location."));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
        (err) => reject(new Error(err.code === 1 ? "Location is turned off for this page. Allow it in the browser’s settings, or try the demo drive." : "Couldn’t get a GPS fix. Try again in a moment.")),
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 10000 });
    });
  }

  // ── Trip state ──────────────────────────────────────────────────────────
  let trip = null;

  function tripClock() {
    if (!trip) return 0;
    return trip.demo ? trip.vtime : (Date.now() - trip.startedAt) / 1000;
  }
  const mmss = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; const ss = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`; };
  const minutes = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const miles = (m) => trip?.imperial ? `${(m / 1609.34).toFixed(m < 16093 ? 1 : 0)} mi` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;

  function addScore(n) { trip.score += n; $("score").textContent = trip.score; }

  // Each page is one game: <body data-game="trivia|photo|categories">.
  const GAME = document.body.dataset.game;
  const has = (id) => !!document.getElementById(id);
  const DEMO_FROM = "Boulder, Colorado", DEMO_TO = "Colorado Springs, Colorado";

  // Town trivia needs no destination: live, it just follows the phone; the
  // demo drives a fixed route. Photo guess needs the route to look ahead.
  async function startTrip(demo) {
    const msg = $("setupMsg");
    msg.className = "msg"; msg.textContent = demo ? "Planning the demo drive…" : "Getting your location…";
    $("start").disabled = true; $("demo").disabled = true;
    try {
      let route = null, dest = null, from, destName = "";
      if (GAME === "photo") {
        let fromText = $("from").value.trim(), toText = $("to").value.trim();
        if (demo && !fromText && !toText) { fromText = DEMO_FROM; toText = DEMO_TO; }
        if (!toText) throw new Error("Type where you’re going first.");
        if (demo && !fromText) throw new Error("For a demo drive, type where it starts too.");
        from = fromText ? (await geocode(fromText)).p : await myPosition();
        msg.textContent = "Finding the route…";
        dest = await geocode(toText); destName = toText;
      } else if (demo) {
        from = (await geocode(DEMO_FROM)).p;
        msg.textContent = "Finding the route…";
        dest = await geocode(DEMO_TO); destName = DEMO_TO;
      } else {
        from = await myPosition();
      }
      if (dest) {
        route = await fetchRoute(from, dest.p);
        if (route.duration < 300) throw new Error("That’s under five minutes away. Pick somewhere further.");
      }
      trip = {
        demo, route, dest, destName, score: 0, startedAt: Date.now(),
        vtime: 0, speed: +$("speed").value, paused: false,
        pos: from, snap: route ? snap(route, from) : null, offCount: 0, lastReroute: 0,
        imperial: false, trivia: GAME === "trivia", photo: GAME === "photo",
        town: undefined, county: undefined, queue: [], showing: null, triviaTypes: [], seenPlaces: new Set(), places: 0,
        round: null, usedPhotos: new Set(), photoSearching: false, photoRetryAt: 0,
        lastPoll: 0, lastPollPos: null, polling: false, timers: [], watch: null, done: false,
        answered: 0, correct: 0, photos: 0,
      };
      msg.textContent = "";
      showTrip();
      if (demo) {
        trip.timers.push(setInterval(demoTick, 500));
      } else {
        trip.watch = navigator.geolocation.watchPosition(
          (pos) => onFix([pos.coords.longitude, pos.coords.latitude]),
          (err) => { if (err.code === 1) say("Location was turned off, so the game can’t follow you any more.", true); },
          { enableHighAccuracy: true, maximumAge: 5000 });
      }
      trip.timers.push(setInterval(tick, 1000));
      keepAwake();
      onFix(from);
      tick();
    } catch (err) {
      msg.className = "msg err"; msg.textContent = err.message || String(err);
      trip = null;
    } finally {
      $("demo").disabled = false; updateStartButton();
    }
  }

  function showTrip() {
    $("setup").hidden = true; $("pastCard").hidden = true;
    $("trip").hidden = false; $("pause").hidden = !trip.demo; $("pause").textContent = "Pause";
    $("end").textContent = "End";
    $("score").textContent = "0"; $("tripMsg").textContent = trip.demo ? `Demo drive at ${trip.speed}× speed. Trip time runs ${trip.speed}× faster too.` : "";
    if (trip.trivia) $("where").textContent = "Finding where we are…";
    else { $("where").innerHTML = "On the way to <em></em>"; $("where").querySelector("em").textContent = trip.destName; }
    $("progress").hidden = !trip.route;
    $("leftLabel").textContent = trip.route ? "To go" : "Places";
    if (trip.trivia) { $("triviaCard").hidden = false; setTriviaIdle("The first question arrives as soon as we know which town we’re in."); }
    if (trip.photo) { $("photoCard").hidden = false; resetPhotoCard("Looking for a photo along the road ahead…"); }
    window.scrollTo({ top: 0 });
  }

  function say(text, bad = false) { const m = $("tripMsg"); m.textContent = text; m.className = bad ? "msg err" : "msg"; }

  // Demo: the car drives the route by itself, at route speed times the multiplier.
  function demoTick() {
    if (!trip || trip.paused || trip.done) return;
    trip.vtime = Math.min(trip.route.duration, trip.vtime + 0.5 * trip.speed);
    onFix(pointAtTime(trip.route, trip.vtime).p);
  }

  function onFix(p) {
    if (!trip || trip.done) return;
    trip.pos = p;
    if (p[1] > 18 && p[1] < 72 && p[0] < -50) trip.imperial = true; // US, as far as distances go
    if (trip.route) {
      const s = snap(trip.route, p, trip.snap.i);
      if (!trip.demo && s.d > 250) {
        trip.offCount++;
        if (trip.offCount >= 3 && Date.now() - trip.lastReroute > 60000) reroute();
      } else {
        trip.offCount = 0;
        // GPS jitter can snap a little backwards; never let progress go back.
        if (s.time >= trip.snap.time - 30) trip.snap = s;
      }
    }
    if (trip.photo) checkPhotoPassed();
    if (trip.trivia) pollPlace();
    if (trip.route && trip.route.duration - trip.snap.time < 45 && (trip.demo || dist(p, trip.dest.p) < 300)) arrive();
  }

  async function reroute() {
    trip.lastReroute = Date.now();
    say("Off the planned route. Finding a new one…");
    try {
      const route = await fetchRoute(trip.pos, trip.dest.p);
      if (!trip) return;
      trip.route = route; trip.snap = snap(route, trip.pos); trip.offCount = 0;
      say("New route found.");
      const r = trip.round;
      if (r && !r.passed) {
        const s = snap(route, r.coord);
        if (s.d > 450 || s.time <= trip.snap.time) { cancelRound("The new route doesn’t go past that photo, so here’s another one."); }
        else r.routeTime = s.time;
      }
    } catch (err) { say("Couldn’t find a new route yet. Trying again soon.", true); }
  }

  function tick() {
    if (!trip || trip.done) return;
    $("clock").textContent = mmss(tripClock());
    if (trip.route) {
      $("left").textContent = minutes(trip.route.duration - trip.snap.time);
      $("left").title = miles(trip.route.distance - trip.snap.meters);
      $("bar").style.width = `${Math.min(100, 100 * trip.snap.time / trip.route.duration).toFixed(1)}%`;
    } else $("left").textContent = trip.places;
    if (trip.photo && !trip.round && !trip.photoSearching && tripClock() >= trip.photoRetryAt) findPhoto();
  }

  function summary() {
    return trip.trivia
      ? `${trip.correct} of ${trip.answered} right, ${trip.score} points.`
      : `${trip.photos} photo${trip.photos === 1 ? "" : "s"} guessed, ${trip.score} points.`;
  }

  function arrive() {
    if (trip.done) return;
    trip.done = true;
    $("where").innerHTML = `Arrived in <em></em>`; $("where").querySelector("em").textContent = trip.destName;
    say(`Trip over. ${summary()}`);
    $("end").textContent = "Done";
    $("left").textContent = "0 min"; $("bar").style.width = "100%";
    if (trip.photo) { if (!trip.round?.passed) resetPhotoCard("We’re here. No more photos this trip."); $("nextPhoto").hidden = true; }
    $("pause").hidden = true;
    saveHistory();
    stopTimers();
  }

  function stopTimers() {
    if (!trip) return;
    trip.timers.forEach(clearInterval); trip.timers = [];
    if (trip.watch != null) navigator.geolocation.clearWatch(trip.watch);
    trip.watch = null;
    releaseAwake();
  }

  function endTrip() {
    if (!trip) return;
    if (!trip.done) { saveHistory(); stopTimers(); }
    trip = null;
    $("trip").hidden = true;
    if (has("triviaCard")) $("triviaCard").hidden = true;
    if (has("photoCard")) $("photoCard").hidden = true;
    $("setup").hidden = false;
    renderHistory();
  }

  // Past games keep only a date and a score: no places, so nobody else using
  // this phone can see where it has been.
  const HISTORY = `roadtrip.history.${GAME}`;
  function saveHistory() {
    if (!trip || trip.saved || (trip.answered === 0 && trip.photos === 0)) return;
    trip.saved = true;
    const list = store.get(HISTORY) || [];
    list.unshift({ demo: trip.demo, score: trip.score, date: new Date().toISOString().slice(0, 10) });
    store.set(HISTORY, list.slice(0, 8));
  }
  function renderHistory() {
    if (!has("pastCard")) return;
    const list = store.get(HISTORY) || [];
    $("pastCard").hidden = !list.length;
    const box = $("history"); box.textContent = "";
    for (const h of list) {
      const row = document.createElement("div");
      const name = document.createElement("span"); name.textContent = `${h.date}${h.demo ? " · demo drive" : ""}`;
      const pts = document.createElement("strong"); pts.textContent = `${h.score} pts`;
      row.append(name, pts); box.append(row);
    }
  }

  // Keep the screen on during a trip: without it the phone sleeps and GPS stops.
  let wake = null;
  async function keepAwake() { try { wake = await navigator.wakeLock?.request("screen"); } catch { /* not supported or refused */ } }
  function releaseAwake() { try { wake?.release(); } catch { /* already gone */ } wake = null; }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && ((trip && !trip.done) || cat)) keepAwake(); });

  // ── Town trivia ─────────────────────────────────────────────────────────
  const SETTLEMENT = new Set(["city", "town", "village", "hamlet", "municipality", "borough", "suburb"]);

  async function pollPlace() {
    const realGap = trip.demo ? 4000 : 30000;
    if (trip.polling || Date.now() - trip.lastPoll < realGap) return;
    if (!trip.demo && trip.lastPollPos && dist(trip.lastPollPos, trip.pos) < 300) return;
    trip.polling = true; trip.lastPoll = Date.now(); trip.lastPollPos = trip.pos;
    const here = trip.pos, t = trip;
    try {
      const r = await reverse(here, 10);
      if (trip !== t) return;
      const a = r.address || {};
      const town = a.city || a.town || a.village || a.hamlet || a.municipality || null;
      const county = a.county || a.state_district || null;
      const townQid = SETTLEMENT.has(r.addresstype) && r.name === town ? r.extratags?.wikidata : null;
      const firstFix = trip.town === undefined;
      const newCounty = county && county !== trip.county;
      const newTown = town && town !== trip.town;
      if (newTown || newCounty) trip.places += (newTown ? 1 : 0) + (newCounty ? 1 : 0);
      trip.town = town; trip.county = county;
      renderWhere();
      if (newCounty) {
        const c = await reverse(here, 8);
        if (trip !== t) return;
        const qid = c.addresstype === "county" || c.name === county ? c.extratags?.wikidata : null;
        enqueue({ kind: "county", name: county, qid, firstFix });
      }
      if (newTown) enqueue({ kind: "town", name: town, qid: townQid, county, firstFix });
    } catch { /* offline for a moment: the next fix tries again */ }
    finally { t.polling = false; }
  }

  function renderWhere() {
    const w = $("where");
    if (!trip.town && !trip.county) { w.textContent = "Somewhere along the road"; return; }
    w.innerHTML = "";
    const em = document.createElement("em"); em.textContent = trip.town || trip.county;
    w.append(trip.town ? "In " : "Crossing ", em);
    if (trip.town && trip.county) w.append(` · ${trip.county}`);
  }

  function enqueue(item) {
    const key = `${item.kind}:${item.qid || item.name}`;
    if (trip.seenPlaces.has(key)) return;
    trip.seenPlaces.add(key);
    // Busy stretches of road cross a lot of boundaries: keep the newest few.
    trip.queue.push(item);
    if (trip.queue.length > 3) trip.queue.shift();
    if (!trip.showing) nextTrivia();
  }

  async function nextTrivia() {
    const t = trip;
    while (trip === t && trip.queue.length) {
      const item = trip.queue.shift();
      trip.showing = item;
      setTriviaIdle(`Crossing into ${item.name}. Looking it up…`);
      let q = null;
      try { q = await buildTrivia(item); } catch { q = null; }
      if (trip !== t) return;
      if (q) { showTrivia(q); return; }
    }
    if (trip === t) { trip.showing = null; setTriviaIdle("Next question when we cross into a new town or county."); }
  }

  function setTriviaIdle(text) {
    $("trivia-title").textContent = "Waiting for the next town";
    $("triviaQ").textContent = ""; $("triviaOpts").textContent = "";
    $("triviaAfter").hidden = true; $("triviaWait").textContent = text;
  }

  async function entities(ids, props) {
    const data = await getJSON(`${WIKIDATA}?${qs({ action: "wbgetentities", ids: ids.join("|"), props, languages: "en", sitefilter: "enwiki", format: "json", origin: "*" })}`);
    return data.entities || {};
  }
  function bestClaim(claims, p) {
    const list = (claims?.[p] || []).filter((c) => c.rank !== "deprecated" && c.mainsnak?.datavalue);
    if (!list.length) return null;
    const preferred = list.filter((c) => c.rank === "preferred");
    const pool = preferred.length ? preferred : list;
    const year = (c) => { const v = c.qualifiers?.P585?.[0]?.datavalue?.value?.time; return v ? parseInt(v.slice(1, 5), 10) : 0; };
    return pool.slice().sort((a, b) => year(b) - year(a))[0].mainsnak.datavalue.value;
  }
  // Two significant figures, so the options read as "about" numbers.
  const round2 = (n) => { if (n <= 0) return 0; const p = 10 ** (Math.floor(Math.log10(n)) - 1); return Math.round(n / p) * p; };
  function numberChoices(value, mults, fmt) {
    const truth = round2(value), seen = new Set([truth]), wrong = [];
    for (const m of shuffle(mults.slice())) {
      const x = round2(value * m);
      if (x > 0 && !seen.has(x)) { seen.add(x); wrong.push(x); }
      if (wrong.length === 3) break;
    }
    return choices(fmt(truth), wrong.map(fmt));
  }
  function choices(right, wrong) {
    const options = shuffle([right, ...wrong.slice(0, 3)]);
    return { options, answer: options.indexOf(right) };
  }
  const nf = (n) => n.toLocaleString("en-US");

  async function buildTrivia(item) {
    if (!item.qid) return null;
    const ents = await entities([item.qid], "claims|sitelinks|labels");
    const e = ents[item.qid];
    if (!e || e.missing !== undefined) return null;
    const c = e.claims || {};
    const label = e.labels?.en?.value || item.name;
    const kinds = [];

    const pop = bestClaim(c, "P1082");
    if (pop && +pop.amount >= 50) kinds.push(["population", () => ({
      question: `About how many people live in ${label}?`,
      ...numberChoices(+pop.amount, [0.2, 0.35, 0.55, 1.9, 3, 4.5], (n) => nf(n)),
    })]);

    const elev = bestClaim(c, "P2044");
    if (elev) {
      const metres = elev.unit?.endsWith("Q3710") ? +elev.amount * 0.3048 : +elev.amount;
      const imperial = trip.imperial, v = imperial ? metres / 0.3048 : metres;
      if (v >= (imperial ? 300 : 100)) kinds.push(["elevation", () => ({
        question: `How high above sea level is ${label}?`,
        ...numberChoices(v, [0.3, 0.5, 0.7, 1.5, 2, 2.8], (n) => `${nf(n)} ${imperial ? "ft" : "m"}`),
      })]);
    }

    const inc = bestClaim(c, "P571");
    if (inc?.time && inc.precision >= 9 && inc.time[0] === "+") {
      const year = parseInt(inc.time.slice(1, 5), 10), now = new Date().getFullYear();
      const wrong = shuffle([-60, -40, -25, -12, 12, 25, 40, 60].map((d) => year + d).filter((y) => y < now - 1)).slice(0, 3);
      if (year > 1000 && wrong.length === 3) kinds.push(["founded", () => ({
        question: item.kind === "county" ? `What year was ${label} formed?` : `What year was ${label} founded?`,
        ...choices(String(year), wrong.map(String)),
      })]);
    }

    const area = bestClaim(c, "P2046");
    if (area) {
      const km2 = area.unit?.endsWith("Q232291") ? +area.amount * 2.58999 : area.unit?.endsWith("Q712226") ? +area.amount : NaN;
      const imperial = trip.imperial, v = imperial ? km2 / 2.58999 : km2;
      if (v >= 1) kinds.push(["area", () => ({
        question: `How much land does ${label} cover?`,
        ...numberChoices(v, [0.25, 0.4, 0.6, 1.7, 2.5, 4], (n) => `${nf(n)} ${imperial ? "sq mi" : "km²"}`),
      })]);
    }

    // County seat: wrong answers are the seats of the counties next door.
    const seat = item.kind === "county" ? bestClaim(c, "P36") : null;
    const neighbours = (c.P47 || []).map((x) => x.mainsnak?.datavalue?.value?.id).filter(Boolean).slice(0, 12);
    if (seat?.id && neighbours.length >= 3) kinds.unshift(["seat", async () => {
      const near = await entities(neighbours, "claims");
      const seats = shuffle(Object.values(near).map((n) => bestClaim(n.claims, "P36")?.id).filter((id) => id && id !== seat.id)).slice(0, 3);
      if (seats.length < 3) return null;
      const names = await entities([seat.id, ...seats], "labels");
      const name = (id) => names[id]?.labels?.en?.value;
      const wrong = seats.map(name).filter(Boolean);
      if (!name(seat.id) || wrong.length < 3) return null;
      return { question: `Which of these is the county seat of ${label}?`, ...choices(name(seat.id), wrong) };
    }]);

    // The plain facts above are the fallback. First try the exciting kinds:
    // who was born here, what was filmed here, landmarks, nicknames, namesakes
    // and sister cities, with wrong answers taken from the towns nearby.
    const exciting = await excitingKinds(item, e, label);
    const recent = trip.triviaTypes.slice(-3);
    const fresh = (list) => [...shuffle(list.filter(([k]) => !recent.includes(k))), ...shuffle(list.filter(([k]) => recent.includes(k)))];
    const seatFirst = kinds[0]?.[0] === "seat" && !recent.includes("seat") ? [kinds.shift()] : [];
    const pick = [...seatFirst, ...fresh(exciting), ...fresh(kinds)];
    if (!pick.length) return null;
    let q = null, kind = null;
    for (const [k, make] of pick.slice(0, 7)) {
      try { q = await make(); } catch { q = null; }
      if (q) { kind = k; break; }
    }
    if (!q) return null;
    trip.triviaTypes.push(kind);

    const title = e.sitelinks?.enwiki?.title;
    const link = title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` : "";
    let fact = "";
    if (title) {
      try { fact = await bestSentence(title); } catch { fact = ""; }
      if (!fact) {
        try {
          const sum = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`);
          fact = trimFact(sum.extract || "");
        } catch { /* the question still works without the fact */ }
      }
    }
    return { ...q, title: label, kind: item.kind, fact, link, firstFix: item.firstFix };
  }

  // ── Exciting trivia from Wikidata's query service ──────────────────────
  // The planner hint keeps these quick (well under two seconds even for a big
  // city); without it some take a minute.
  const WDQS = "https://query.wikidata.org/sparql";
  async function sparql(query) {
    const d = await getJSON(`${WDQS}?${qs({ query, format: "json" })}`);
    const ENTITY = "http://www.wikidata.org/entity/";
    return (d.results?.bindings || []).map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value.startsWith(ENTITY) ? v.value.slice(ENTITY.length) : v.value])));
  }
  // Populated places within 40 km of a town or county, biggest first.
  async function nearbyPlaces(qid) {
    const rows = await sparql(`SELECT ?p ?pop WHERE {
      wd:${qid} wdt:P625 ?c.
      SERVICE wikibase:around { ?p wdt:P625 ?loc. bd:serviceParam wikibase:center ?c; wikibase:radius "40". }
      ?p wdt:P1082 ?pop. FILTER(?pop >= 2000 && ?p != wd:${qid})
    } ORDER BY DESC(?pop) LIMIT 24`);
    return [...new Set(rows.map((r) => r.p))].filter((id) => /^Q\d+$/.test(id));
  }
  // For one relation, everything linked to this place and to its neighbours,
  // most famous first (by number of Wikipedia languages).
  const POOLS = {
    born: { pattern: "?x wdt:P19 ?p.", min: 12 },
    filmed: { pattern: "?x wdt:P915 ?p.", min: 8 },
    landmark: { pattern: "?x wdt:P131 ?p. FILTER NOT EXISTS { ?x wdt:P1082 [] } FILTER NOT EXISTS { ?x wdt:P31 wd:Q5 }", min: 10 },
    namesake: { pattern: "?p wdt:P138 ?x.", min: 5 },
    twin: { pattern: "?p wdt:P190 ?x.", min: 5 },
  };
  async function pool(kind, here, near) {
    const { pattern, min } = POOLS[kind];
    const places = [here, ...near].map((id) => `wd:${id}`).join(" ");
    const rows = await sparql(`SELECT ?p ?x ?links WHERE {
      hint:Query hint:optimizer "None".
      VALUES ?p { ${places} } ${pattern}
      ?x wikibase:sitelinks ?links. FILTER(?links >= ${min})
    } ORDER BY DESC(?links) LIMIT 150`);
    const mine = [...new Set(rows.filter((r) => r.p === here).map((r) => r.x))];
    const theirs = [...new Set(rows.filter((r) => r.p !== here && !mine.includes(r.x)).map((r) => r.x))];
    return { mine, theirs };
  }
  // Labels and one-line descriptions, dropping any that give the answer away
  // (a landmark called "Boulder Creek" in a question about Boulder).
  async function named(ids, giveaway) {
    const ents = await entities(ids, "labels|descriptions");
    const out = {};
    for (const id of ids) {
      const name = ents[id]?.labels?.en?.value;
      if (!name || /^Q\d+$/.test(name) || name.length > 60) continue;
      if (giveaway && name.toLowerCase().includes(giveaway.toLowerCase())) continue;
      out[id] = { name, desc: ents[id]?.descriptions?.en?.value || "" };
    }
    return out;
  }
  const personish = (desc) => /\b(1[5-9]\d\d|20\d\d)\b|\b(politician|president|general|explorer|officer|governor|senator|soldier|chief|missionary|settler|pioneer|businessman|businesswoman|merchant|surveyor|judge|inventor|writer|activist|leader|founder)\b/i.test(desc);
  const pickFew = (list, n, top) => shuffle(list.slice(0, top)).slice(0, n);
  const lead = (desc) => (desc ? `, ${desc}` : "");

  async function excitingKinds(item, e, label) {
    let near = null;
    const nearby = async () => (near ??= await nearbyPlaces(e.id));
    const short = label.split(",")[0];
    // One relation, as a question: the right answer belongs to this place, the wrong ones to neighbours.
    const fromPool = (kind, ask, explain) => async () => {
      const { mine, theirs } = await pool(kind, e.id, (await nearby()).slice(0, 16));
      if (!mine.length || theirs.length < 3) return null;
      const right = pickFew(mine, 1, 3), wrong = pickFew(theirs, 6, 14);
      const names = await named([...right, ...wrong], kind === "namesake" || kind === "twin" ? null : short);
      const answer = names[right[0]];
      let others = wrong.map((id) => names[id]).filter((n) => n && n.name !== answer?.name);
      // Named after a person? Then the wrong answers should be people too, not places.
      if (answer && kind === "namesake") {
        const alike = others.filter((n) => personish(n.desc) === personish(answer.desc));
        if (alike.length >= 3) others = alike;
      }
      others = others.map((n) => n.name);
      if (!answer || others.length < 3) return null;
      return { question: ask, ...choices(answer.name, [...new Set(others)].slice(0, 3)), detail: explain(answer) };
    };
    const out = [];
    if (item.kind === "town") {
      out.push(["born", fromPool("born", `Which of these famous people was born in ${short}?`, (a) => `${a.name}${lead(a.desc)}, was born here.`)]);
      out.push(["filmed", fromPool("filmed", `Which of these was filmed in ${short}?`, (a) => `${a.name}${lead(a.desc)}, was filmed here.`)]);
      out.push(["twin", fromPool("twin", `Which of these is a sister city of ${short}?`, (a) => `${a.name}${lead(a.desc)}, is ${short}’s sister city.`)]);
    }
    out.push(["landmark", fromPool("landmark", `Which of these is in ${short}?`, (a) => `${a.name}${lead(a.desc)}, is here.`)]);
    if (e.claims?.P138) out.push(["namesake", fromPool("namesake", `Who or what is ${short} named after?`, (a) => `${short} is named after ${a.name}${lead(a.desc)}.`)]);
    const nick = (e.claims?.P1449 || []).map((c) => c.mainsnak?.datavalue?.value).find((v) => v?.language === "en" && v.text.length <= 50);
    if (nick && item.kind === "town") out.push(["nickname", async () => {
      // Wrong answers: other towns nearby (by their descriptions, not counties or metro areas).
      const ents = await entities((await nearby()).slice(0, 20), "labels|descriptions");
      const towns = Object.values(ents)
        .filter((x) => /\b(city|town|village|municipality|borough|capital)\b/i.test(x.descriptions?.en?.value || "") && !/\b(county|metropolitan|area|region|district|census)\b/i.test(x.descriptions?.en?.value || ""))
        .map((x) => x.labels?.en?.value?.split(",")[0]).filter((n) => n && n !== short);
      const wrong = pickFew([...new Set(towns)], 3, 8);
      if (wrong.length < 3) return null;
      return { question: `Which of these places is nicknamed “${nick.text}”?`, ...choices(short, wrong), detail: `${short} is nicknamed “${nick.text}”.` };
    }]);
    return out;
  }

  // "Did you know?": the most interesting sentence in the Wikipedia article,
  // scored on words like first, oldest, world, birthplace, filmed, haunted;
  // census, election and policy sentences are left out.
  const LIVELY = /\b(first|only|oldest|largest|biggest|highest|longest|tallest|smallest|deepest|world'?s?|famous|famously|known as|nicknamed|home to|birthplace|invented|record|filmed|named (?:after|for)|legend|legendary|haunted|gold rush|discovered|nation'?s|America'?s|unique|claim to fame|best known|inspired|ghost|outlaw|dinosaur|olympic|president|movie|film|song|hollywood|rodeo|festival|museum)\b/gi;
  const DULL = /\b(census|median|household|per capita|percent|%|square mile|km2|population density|racial|makeup|income|poverty|ZIP|area code|school district|elected|council|mayor|commissioner|Köppen|precipitation|average temperature|vote|votes|voted|election|Democratic|Republican|regulation|ordinance|zoning|budget|tax)\b/i;
  const ORPHAN = /^(He|She|They|These|Those|His|Her|Their|Construction|Later|Afterward|Afterwards|The (campus|building|park|school|church|team|company|station|museum|site|house|mine|bridge|lake|dam|hotel|store|club|event|race|festival|show|band|film|song|book|game))\b/;
  async function bestSentence(title) {
    const d = await getJSON(`https://en.wikipedia.org/w/api.php?${qs({ action: "query", prop: "extracts", explaintext: 1, exsectionformat: "plain", redirects: 1, titles: title, format: "json", formatversion: 2, origin: "*" })}`);
    const text = (d.query?.pages?.[0]?.extract || "").slice(0, 120000);
    const sentences = text.split(/\n+/)
      .flatMap((para) => para.split(/(?<=[a-z0-9)\]"”’][.!?])\s+(?=[A-Z“"])/))
      .map((x) => x.trim()).filter((x) => x.length >= 60 && x.length <= 260 && /[.!?]$/.test(x));
    const scored = sentences
      // Sentences that lean on the one before ("He…", "The campus…") make no sense alone.
      .map((x, i) => ({ x, score: (x.match(LIVELY) || []).length * 3 - (DULL.test(x) ? 10 : 0) + (/\b1[6-9]\d\d\b/.test(x) ? 1 : 0) - (ORPHAN.test(x) ? 6 : 0) - i / 400 }))
      .filter((c) => c.score > 2.5).sort((a, b) => b.score - a.score);
    return scored.length ? pickFew(scored, 1, 3)[0].x : "";
  }

  // Two or three sentences from the Wikipedia summary, skipping the bare "X is a town in Y" opener when there's more.
  function trimFact(text) {
    // Split after ". " only when a lowercase letter or digit ends the sentence, so "U.S. Senator" and "Stephen A. Douglas" stay whole.
    const sentences = text.split(/(?<=[a-z0-9)\]"”’][.!?])\s+(?=[A-Z“"])/);
    let pick = sentences.map((s) => s.trim()).filter(Boolean);
    if (pick.length > 2 && pick[0].length < 140) pick = pick.slice(1);
    let out = "";
    for (const s of pick) { if ((out + " " + s).length > 340 && out) break; out = out ? `${out} ${s}` : s; }
    return out;
  }

  function showTrivia(q) {
    const card = $("triviaCard");
    card.classList.remove("pop"); void card.offsetWidth; card.classList.add("pop");
    navigator.vibrate?.(60);
    $("trivia-title").textContent = q.firstFix ? `Starting in ${q.title}` : `Welcome to ${q.title}`;
    $("triviaQ").textContent = q.question;
    $("triviaWait").textContent = "";
    $("triviaAfter").hidden = true;
    const box = $("triviaOpts"); box.textContent = "";
    q.options.forEach((text, i) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = text;
      b.addEventListener("click", () => answerTrivia(q, i));
      box.append(b);
    });
  }

  function answerTrivia(q, i) {
    if (!trip) return;
    const buttons = [...$("triviaOpts").children];
    buttons.forEach((b, j) => { b.disabled = true; if (j === q.answer) b.classList.add("right"); else if (j === i) b.classList.add("wrong"); });
    const right = i === q.answer;
    trip.answered++;
    if (right) { trip.correct++; addScore(10); }
    const why = q.detail || `It’s ${q.options[q.answer]}.`;
    $("triviaResult").textContent = right ? `Right! +10 points. ${why}` : `Not quite. ${why}`;
    $("triviaFact").textContent = q.fact ? `Did you know? ${q.fact}` : "";
    $("triviaFact").hidden = !q.fact;
    $("triviaLink").href = q.link; $("triviaLink").hidden = !q.link;
    $("triviaAfter").hidden = false;
    const t = trip;
    // Leave the fact up a while, then move on to anything waiting.
    setTimeout(() => { if (trip === t && t.showing && $("triviaAfter").hidden === false) { t.showing = null; if (t.queue.length) nextTrivia(); else $("triviaWait").textContent = "Next question when we cross into a new town or county."; } }, 15000);
  }

  // ── Photo guess ─────────────────────────────────────────────────────────
  const SKIP_TITLE = /\b(map|maps|logo|seal|flag|diagram|plan|chart|coat of arms|interior|inside|menu|document|screenshot)\b/i;

  async function findPhoto() {
    const t = trip, route = trip.route;
    trip.photoSearching = true;
    resetPhotoCard("Looking for a photo along the road ahead…");
    try {
      const now = trip.snap.time, end = route.duration - 120;
      if (end - now < 6 * 60) { resetPhotoCard("Not enough road left for another photo."); trip.photoRetryAt = Infinity; return; }
      // Spots 6 to 40 minutes ahead, tried in a shuffled order so rounds vary in length.
      const times = [];
      for (let s = now + 6 * 60; s <= Math.min(end, now + 40 * 60); s += 150) times.push(s);
      for (const at of shuffle(times).slice(0, 8)) {
        if (trip !== t) return;
        const { p, i } = pointAtTime(route, at);
        const data = await getJSON(`https://commons.wikimedia.org/w/api.php?${qs({
          action: "query", generator: "geosearch", ggscoord: `${p[1]}|${p[0]}`, ggsradius: 400, ggsnamespace: 6, ggslimit: 25,
          prop: "imageinfo|coordinates", iiprop: "url|mime|size|extmetadata", iiurlwidth: 1024,
          iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName", format: "json", formatversion: 2, origin: "*",
        })}`);
        if (trip !== t) return;
        const candidates = [];
        for (const page of data.query?.pages || []) {
          const info = page.imageinfo?.[0], at2 = page.coordinates?.[0];
          if (!info || !at2 || info.mime !== "image/jpeg" || info.width < 800 || info.width < info.height * 0.9) continue;
          if (SKIP_TITLE.test(page.title) || trip.usedPhotos.has(page.title)) continue;
          const coord = [at2.lon, at2.lat], s = snap(route, coord, i);
          if (s.d > 350 || s.time < trip.snap.time + 5 * 60) continue;
          candidates.push({ page, info, coord, s });
        }
        if (!candidates.length) continue;
        candidates.sort((a, b) => a.s.d - b.s.d);
        const pick = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
        trip.usedPhotos.add(pick.page.title);
        startRound(pick);
        return;
      }
      resetPhotoCard("No photos of the road ahead yet. Trying again in a few minutes.");
      trip.photoRetryAt = tripClock() + 4 * 60;
    } catch {
      if (trip === t) { resetPhotoCard("Couldn’t reach Wikimedia Commons. Trying again shortly."); trip.photoRetryAt = tripClock() + 90; }
    } finally { t.photoSearching = false; }
  }

  function resetPhotoCard(status) {
    $("photo-title").textContent = "When will we pass this spot?";
    $("photoStatus").textContent = status;
    $("photoBox").hidden = true; $("guessBox").hidden = true; $("photoReveal").hidden = true; $("nextPhoto").hidden = true;
  }

  function startRound({ page, info, coord, s }) {
    const m = info.extmetadata || {};
    trip.round = {
      title: page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
      pageUrl: info.descriptionurl, coord, routeTime: s.time,
      shownAt: tripClock(), guess: null, guessAt: null, passed: false,
    };
    $("photoStatus").textContent = "Somewhere along our route. Guess how many minutes until we drive past it.";
    $("photoImg").src = info.thumburl || info.url;
    const credit = $("photoCredit"); credit.textContent = "";
    const author = textOf(m.Artist?.value) || "Unknown author";
    const lic = m.LicenseShortName?.value || "see file page";
    credit.append(`Photo: ${author.slice(0, 80)} · `);
    const a = document.createElement("a");
    a.textContent = lic; a.target = "_blank"; a.rel = "noreferrer";
    a.href = m.LicenseUrl?.value || info.descriptionurl;
    credit.append(a, " · Wikimedia Commons");
    $("photoBox").hidden = false;
    $("guessBox").hidden = false; $("lock").disabled = false; $("skip").disabled = false;
    $("guess").disabled = false;
    $("guess").value = 15; $("guessOut").textContent = "15 min";
  }

  function lockGuess() {
    const r = trip?.round;
    if (!r || r.passed || r.guess != null) return;
    r.guess = +$("guess").value; r.guessAt = tripClock();
    $("guess").disabled = true; $("lock").disabled = true; $("skip").disabled = true;
    $("photoStatus").textContent = `Locked in: about ${r.guess} min. Keep an eye out the window.`;
  }

  function cancelRound(why) {
    if (!trip) return;
    trip.round = null; trip.photoRetryAt = 0;
    resetPhotoCard(why);
  }

  function checkPhotoPassed() {
    const r = trip.round;
    if (!r || r.passed) return;
    const close = dist(trip.pos, r.coord) < 120;
    if (trip.snap.time < r.routeTime - 2 && !close) return;
    r.passed = true;
    navigator.vibrate?.([80, 60, 80]);
    $("guessBox").hidden = true;
    $("photo-title").textContent = "We’re passing it now!";
    const el = $("photoReveal"); el.hidden = false; el.className = "reveal big"; el.textContent = "";
    const name = document.createElement("strong"); name.textContent = r.title;
    if (r.guess == null) {
      el.append("Look out the window: ", name, ". Too late for a guess this time.");
    } else {
      const actual = (tripClock() - r.guessAt) / 60;
      const off = Math.abs(actual - r.guess);
      const pts = Math.round(100 * Math.max(0, 1 - off / Math.max(actual, 3)));
      addScore(pts); trip.photos++;
      el.append("Look out the window: ", name, `. You guessed ${r.guess} min; it took ${Math.max(1, Math.round(actual))} min. +${pts} points.`);
    }
    const link = document.createElement("a");
    link.href = r.pageUrl; link.target = "_blank"; link.rel = "noreferrer"; link.textContent = " About this photo";
    el.append(link);
    $("photoStatus").textContent = "";
    $("nextPhoto").hidden = false;
    const t = trip;
    setTimeout(() => { if (trip === t && t.round === r) nextPhoto(); }, trip.demo ? 15000 : 60000);
  }

  function nextPhoto() { if (!trip || trip.done) return; trip.round = null; trip.photoRetryAt = 0; tick(); }

  // ── Categories ──────────────────────────────────────────────────────────
  // A turn-taking word game. The state is one plain object and every change is
  // a pure function of it (catAct), so the same code runs on one phone or in a
  // room, where a transaction applies it. A room holds this game only: letter,
  // category, timer, names and scores. Never a location.
  const LETTERS = "ABCDEFGHIJKLMNOPRSTW", HARD_LETTERS = "QUVYZ";
  const CATEGORIES = [
    "Things in a kitchen", "Animals", "Foods", "Things at the beach", "Countries", "Cities", "First names", "Sports",
    "Things with wheels", "Things that are cold", "Things in a backpack", "Fruits", "Vegetables", "Things you see on a road trip",
    "Movies", "TV shows", "Songs", "Bands or singers", "Things in a bathroom", "Things that fly", "Board games", "Desserts",
    "Breakfast foods", "Jobs", "Things in a toolbox", "Clothes", "Car brands", "Things that are round", "Things in the sky",
    "Famous people", "Cartoon characters", "Things at a zoo", "Things at a party", "Things in a park", "Pizza toppings",
    "Ice cream flavours", "Musical instruments", "Body parts", "Things in a classroom", "School subjects", "Superheroes",
    "Things that are sticky", "Things that are loud", "Things you plug in", "Hobbies", "Insects", "Birds", "Sea creatures",
    "Trees and plants", "Flowers", "Things in a garden", "Places in a town", "Shops", "Snacks", "Drinks", "Sweets and candy",
    "Things you can read", "Things with buttons", "Things that open and close", "Things in a bedroom", "Furniture",
    "Weather words", "Things on a farm", "Pets", "Dog breeds", "Things that bounce", "Things people collect",
    "Rivers, lakes and seas", "States or provinces", "Holidays", "Things in winter", "Things in summer", "Camping gear",
    "Things in a car", "Things that are green", "Things that are red", "Things that are soft", "Things that smell good",
    "Halloween costumes", "Video games", "Book characters", "Famous landmarks", "Languages", "Things in a fridge",
    "Excuses for being late", "Things that are scary", "Things to do on a rainy day", "Presents", "Things in a wallet",
    "Office supplies", "Things made of wood", "Things made of metal", "Things with a tail", "Things that grow",
    "Things that melt", "Verbs", "Words that describe a person", "Things in a hospital", "Things at a wedding",
    "Things in space", "Things with stripes", "Things you find in a forest", "Things in a city", "Things you can throw",
  ];
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function catSpin(s) {
    let used = (s.used || "").split(",").filter(Boolean).map(Number);
    let free = CATEGORIES.map((_, i) => i).filter((i) => !used.includes(i));
    if (!free.length) { free = CATEGORIES.map((_, i) => i); used = []; }
    const ci = pick(free);
    const letter = pick((LETTERS + (s.hard ? HARD_LETTERS : "")).split(""));
    const next = { ...s, phase: "spun", letter, category: CATEGORIES[ci], used: [...used, ci].slice(-60).join(","),
      round: (s.round || 0) + 1, answers: 0, alive: s.players.map(() => true), turn: s.starter || 0, deadline: 0 };
    delete next.event;
    return next;
  }
  const nextAlive = (s, from) => { const n = s.players.length; for (let k = 1; k <= n; k++) { const i = (from + k) % n; if (s.alive[i]) return i; } return from; };

  // Every action returns the next state, or undefined to leave it alone. `step`
  // guards against stale taps: a "Got one" meant for an earlier turn is ignored.
  function catAct(s, a, now) {
    const limit = (s?.limit || 8) * 1000;
    const bump = (n) => ({ ...n, step: (s?.step || 0) + 1 });
    switch (a.type) {
      case "start": {
        const old = new Map((s?.players || []).map((p) => [p.name, p.score]));
        const players = a.names.map((name) => ({ name, score: old.get(name) || 0 }));
        return bump(catSpin({ ...(s || {}), players, starter: 0, limit: a.limit, hard: a.hard, voice: a.voice }));
      }
      case "respin": return s?.phase === "spun" ? bump(catSpin(s)) : undefined;
      case "go": return s?.phase === "spun" ? bump({ ...s, phase: "turn", turn: s.starter % s.players.length, deadline: now + limit }) : undefined;
      case "got":
        if (s?.phase !== "turn" || s.step !== a.step) return undefined;
        return bump({ ...s, answers: s.answers + 1, turn: nextAlive(s, s.turn), deadline: now + limit });
      case "out": {
        if (s?.phase !== "turn" || s.step !== a.step) return undefined;
        const id = (s.step || 0) + 1;
        const alive = s.alive.slice(); alive[s.turn] = false;
        const players = s.players.map((p) => ({ ...p }));
        const left = alive.filter(Boolean).length;
        if (players.length === 1) {
          players[0].score = Math.max(players[0].score, s.answers);
          return bump({ ...s, alive, players, phase: "roundover", event: { kind: "solo", who: 0, n: s.answers, id } });
        }
        if (left <= 1) {
          const who = alive.indexOf(true);
          players[who].score += 1;
          return bump({ ...s, alive, players, phase: "roundover", starter: (s.starter + 1) % players.length, event: { kind: "win", who, n: s.answers, id } });
        }
        // A short grace after someone is knocked out, so the announcement doesn't eat the next turn.
        return bump({ ...s, alive, turn: nextAlive({ ...s, alive }, s.turn), deadline: now + limit + 2500, event: { kind: "out", who: s.turn, id } });
      }
      case "next": return s?.phase === "roundover" ? bump(catSpin(s)) : undefined;
      case "edit": return s ? bump({ ...s, phase: "setup" }) : undefined;
      default: return undefined;
    }
  }

  // ── Realtime client ─────────────────────────────────────────────────────
  // Just enough of the mouro.ai realtime protocol (the one @mouro/realtime
  // speaks) for one room: hello, get, set, update, txn, sub. This page has no
  // build step, so it can't import the TypeScript package.
  function realtime(database) {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/rt`;
    const TOKEN = "roadtrip.rt.token";
    const pending = new Map(), subs = new Map();
    let ws = null, open = false, closed = false, nextId = 1, backoff = 500, onReady;
    let ready = new Promise((r) => { onReady = r; });
    const api = { uid: null, offset: 0, onstatus: null };
    const send = (o) => { if (open) ws.send(JSON.stringify(o)); };
    function connect() {
      ws = new WebSocket(url);
      ws.onopen = () => { let token = null; try { token = localStorage.getItem(TOKEN); } catch { /* none */ } ws.send(JSON.stringify({ op: "hello", db: database, token })); };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m.op === "welcome") {
          api.uid = m.uid; api.offset = m.now - Date.now(); open = true; backoff = 500;
          try { localStorage.setItem(TOKEN, m.token); } catch { /* private mode: a new identity next time */ }
          for (const [sid, sub] of subs) send({ op: "sub", sid, path: sub.path });
          for (const p of pending.values()) ws.send(p.body);
          onReady(); api.onstatus?.(true);
        } else if (m.op === "value") subs.get(m.sid)?.cb(m.value ?? null);
        else if (m.op === "cancel") { const sub = subs.get(m.sid); subs.delete(m.sid); sub?.onCancel?.(m.code); }
        else if (m.id !== undefined) { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.resolve(m); } }
      };
      ws.onclose = () => {
        if (open) { open = false; ready = new Promise((r) => { onReady = r; }); api.onstatus?.(false); }
        if (!closed) setTimeout(connect, backoff = Math.min(backoff * 2, 8000));
      };
    }
    async function request(op, fields) {
      await ready;
      const id = nextId++, body = JSON.stringify({ id, op, ...fields });
      return new Promise((resolve) => { pending.set(id, { body, resolve }); if (open) ws.send(body); });
    }
    async function call(op, fields) {
      const r = await request(op, fields);
      if (!r.ok) { const err = new Error(r.error || r.code); err.code = r.code; throw err; }
      return r.value;
    }
    api.ready = () => ready;
    api.get = (path) => call("get", { path });
    api.set = (path, value) => call("set", { path, value });
    api.update = (path, values) => call("update", { path, values });
    api.txn = async (path, fn) => {
      let base = await api.get(path);
      for (let i = 0; i < 12; i++) {
        const next = fn(base);
        if (next === undefined) return base;
        const r = await request("txn", { path, base, value: next });
        if (r.ok) return r.value;
        if (r.code !== "stale") { const err = new Error(r.error || r.code); err.code = r.code; throw err; }
        base = r.value ?? null;
      }
      throw new Error("Too busy, try again.");
    };
    api.sub = (path, cb, onCancel) => {
      const sid = `s${nextId++}`;
      subs.set(sid, { path, cb, onCancel });
      send({ op: "sub", sid, path });
      return () => { subs.delete(sid); send({ op: "unsub", sid }); };
    };
    api.close = () => { closed = true; ws?.close(); };
    connect();
    return api;
  }
  const SERVER_NOW = { ".sv": "timestamp" };
  const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

  // ── Categories: sound ───────────────────────────────────────────────────
  let audio = null;
  function unlockSound() {
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch { audio = null; }
    // iOS only speaks after speech has been started from a tap once.
    try { speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch { /* no speech */ }
  }
  function beep(freq = 880, ms = 120, vol = 0.15) {
    if (!audio) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; g.gain.value = vol;
    o.connect(g); g.connect(audio.destination);
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + ms / 1000); o.stop(audio.currentTime + ms / 1000 + 0.02);
  }
  function speak(text) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.lang = "en-US";
      speechSynthesis.speak(u);
    } catch { /* no speech on this device */ }
  }

  // ── Categories: session ─────────────────────────────────────────────────
  // role: "local" (one phone, no room), "screen" (the car screen: a room host
  // that shows big, speaks, and has a few big buttons) or "remote" (a
  // passenger's phone joined by code: same buttons, silent).
  let cat = null;

  function catMsg(text, bad = false) { const m = $("catMsg"); m.textContent = text; m.className = bad ? "msg err" : "msg"; }
  function catStatus(text, bad = false) { const m = $("catStatus"); m.textContent = text; m.className = bad ? "msg err" : "msg"; }

  async function openCat(role, code) {
    if (cat) closeCat();
    unlockSound();
    cat = { role, code: null, state: null, client: null, unsubs: [], tick: null, seenRound: null, seenEvent: null, seenStep: null, timedOut: null, lastTouch: 0, spinning: false, lastBeep: null };
    const c = cat;
    if (role !== "local") {
      catMsg(role === "screen" ? "Opening a car screen…" : "Joining…");
      c.client = realtime("road-trip");
      c.client.onstatus = (up) => { if (cat === c) catStatus(up ? "" : "Lost the connection. Reconnecting…", !up); };
      try {
        await Promise.race([c.client.ready(), sleep(10000).then(() => { throw new Error("Couldn’t reach the game server. Check the signal and try again."); })]);
        if (role === "screen") {
          for (let i = 0; i < 6 && !c.code; i++) {
            const tryCode = Array.from({ length: 5 }, () => pick(CODE_CHARS.split(""))).join("");
            const now = Date.now() + c.client.offset;
            try { await c.client.set(`rooms/${tryCode}`, { meta: { host: c.client.uid, createdAt: now, updatedAt: now } }); c.code = tryCode; }
            catch (err) { if (err.code !== "permission_denied") throw err; }
          }
          if (!c.code) throw new Error("Couldn’t open a room. Try again.");
        } else {
          c.code = code;
          try { await c.client.set(`rooms/${code}/members/${c.client.uid}`, SERVER_NOW); }
          catch (err) { throw new Error(err.code === "permission_denied" ? `No car screen with the code ${code}. Check it and try again.` : err.message); }
        }
      } catch (err) {
        c.client.close(); if (cat === c) cat = null;
        catMsg(err.message || String(err), true);
        return;
      }
      if (cat !== c) { c.client.close(); return; }
      c.unsubs.push(c.client.sub(`rooms/${c.code}/state`, (v) => onCatState(c, v), () => roomGone(c)));
      if (role === "screen") c.unsubs.push(c.client.sub(`rooms/${c.code}/members`, (m) => { c.members = m ? Object.keys(m).length : 0; renderCat(); }));
    }
    catMsg("");
    document.body.classList.toggle("screen-mode", role === "screen");
    $("catIntro").hidden = true;
    $("cat").hidden = false;
    $("catCode").hidden = role === "local"; $("catCode").textContent = c.code || "";
    $("cat-title").textContent = role === "screen" ? "Car screen" : role === "remote" ? "Remote" : "Categories";
    c.tick = setInterval(() => catTick(c), 100);
    keepAwake();
    if (role === "local") onCatState(c, null);
    if (location.search) history.replaceState(null, "", location.pathname);
    $("cat").scrollIntoView({ block: "start" });
  }

  function roomGone(c) {
    if (cat !== c) return;
    closeCat();
    catMsg("The car screen closed the game.");
  }

  function closeCat() {
    const c = cat;
    if (!c) return;
    cat = null;
    clearInterval(c.tick);
    c.unsubs.forEach((u) => u());
    if (c.client) {
      const path = c.role === "screen" ? `rooms/${c.code}` : `rooms/${c.code}/members/${c.client.uid}`;
      c.client.set(path, null).catch(() => {}).finally(() => c.client.close());
    }
    try { speechSynthesis.cancel(); } catch { /* none */ }
    document.body.classList.remove("screen-mode");
    $("cat").hidden = true;
    $("catIntro").hidden = false;
    releaseAwake();
  }

  const catNow = (c) => Date.now() + (c.client ? c.client.offset : 0);

  async function catDo(action) {
    const c = cat;
    if (!c) return;
    if (c.role === "local") {
      const next = catAct(c.state, action, catNow(c));
      if (next) onCatState(c, { ...next, version: (c.state?.version || 0) + 1, by: "local" });
      return;
    }
    try {
      await c.client.txn(`rooms/${c.code}/state`, (cur) => {
        const next = catAct(cur, action, catNow(c));
        return next ? { ...next, version: (cur?.version || 0) + 1, by: c.client.uid } : undefined;
      });
      // Keep the room from looking idle to the reaper on a long drive.
      if (Date.now() - c.lastTouch > 10 * 60000) { c.lastTouch = Date.now(); c.client.update(`rooms/${c.code}/meta`, { updatedAt: SERVER_NOW }).catch(() => {}); }
    } catch (err) {
      if (cat === c) catStatus(err.code === "permission_denied" ? "That game is closed." : "Couldn’t send that. Try again.", true);
    }
  }

  function onCatState(c, s) {
    if (cat !== c) return;
    const prev = c.state;
    c.state = s;
    const speaks = c.role !== "remote" && s?.voice !== false;
    if (s && (s.phase === "spun") && s.round !== c.seenRound) {
      c.seenRound = s.round;
      spinAnimation(c, s, speaks);
    }
    if (s?.event && s.event.id !== c.seenEvent) {
      c.seenEvent = s.event.id;
      const name = s.players[s.event.who]?.name || "Someone";
      const text = s.event.kind === "out" ? `${name} is out.` : s.event.kind === "win" ? `${name} wins the round!` : `${s.event.n} answer${s.event.n === 1 ? "" : "s"}. ${s.event.n >= (s.players[0]?.score || 0) && s.event.n > 0 ? "Your best yet." : ""}`;
      if (c.role !== "remote") { beep(220, 380, 0.2); navigator.vibrate?.(200); }
      if (speaks) setTimeout(() => { if (cat === c) speak(s.event.kind === "out" ? `${text} ${s.players[s.turn]?.name || ""}, go.` : text); }, 350);
    } else if (s?.phase === "turn" && s.step !== c.seenStep && prev?.phase === "turn" && s.players.length > 1) {
      if (speaks) speak(s.players[s.turn].name);
      if (c.role !== "remote") beep(660, 70, 0.1);
    } else if (s?.phase === "turn" && prev?.phase === "spun" && speaks) {
      speak(`${s.players[s.turn].name}, go.`);
    }
    c.seenStep = s?.step;
    renderCat();
  }

  function spinAnimation(c, s, speaks) {
    c.spinning = true;
    $("spinBox").classList.add("spinning");
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (cat !== c) return clearInterval(iv);
      $("catLetter").textContent = pick(LETTERS.split(""));
      $("catCategory").textContent = pick(CATEGORIES);
      if (c.role !== "remote") beep(1200 + Math.random() * 400, 25, 0.05);
      if (Date.now() - t0 > 1100) {
        clearInterval(iv);
        c.spinning = false;
        $("spinBox").classList.remove("spinning");
        renderCat();
        if (speaks) speak(`${s.letter}. ${s.category}.`);
      }
    }, 70);
  }

  function catTick(c) {
    if (cat !== c || !c.state || c.state.phase !== "turn") return;
    const s = c.state, left = s.deadline - catNow(c);
    const secs = Math.max(0, Math.ceil(left / 1000));
    $("catTime").textContent = secs;
    $("ring").style.setProperty("--p", Math.max(0, Math.min(1, left / (s.limit * 1000))).toFixed(3));
    $("ring").classList.toggle("low", secs <= 3);
    if (c.role !== "remote" && secs <= 3 && secs > 0 && c.lastBeep !== `${s.step}:${secs}`) { c.lastBeep = `${s.step}:${secs}`; beep(990, 90, 0.12); }
    // Time's up. The screen (or the one phone) calls it; remotes only step in
    // if the screen has gone quiet. `step` makes sure it is called once.
    const grace = c.role === "remote" ? 1500 : 150;
    if (left < -grace && c.timedOut !== s.step) { c.timedOut = s.step; catDo({ type: "out", step: s.step }); }
  }

  function renderCat() {
    const c = cat;
    if (!c) return;
    const s = c.state, controls = true;
    const setup = !s || s.phase === "setup";
    if (c.role === "screen" && !$("catStatus").classList.contains("err")) {
      const joined = c.members ? `${c.members} remote${c.members === 1 ? "" : "s"} connected.` : "";
      catStatus(setup ? `${joined} Set up here, or join from another phone: mouro.ai/games/road-trip/categories, code ${c.code}.`.trim() : joined);
    }
    $("catSetup").hidden = !(setup && controls);
    $("catBoard").hidden = setup && controls;
    $("turnline").hidden = setup;
    $("catBoard").dataset.phase = s?.phase || "setup";
    if (setup) {
      if (!$("names").children.length) fillNames(s?.players?.map((p) => p.name));
      return;
    }
    if (!c.spinning) { $("catLetter").textContent = s.letter; $("catCategory").textContent = s.category; }
    const cur = s.players[s.turn]?.name || "";
    $("whoLabel").textContent = s.phase === "turn" ? "Turn" : s.phase === "spun" ? "First up" : "Round over";
    $("catWho").textContent = s.phase === "roundover" ? "" : cur;
    $("catCount").textContent = s.phase === "spun" ? "" : `${s.answers} answer${s.answers === 1 ? "" : "s"} so far`;
    if (s.phase !== "turn") { $("catTime").textContent = s.phase === "spun" ? s.limit : "–"; $("ring").style.setProperty("--p", 1); $("ring").classList.remove("low"); }
    const chips = $("chips"); chips.textContent = "";
    s.players.forEach((p, i) => {
      const el = document.createElement("span");
      el.textContent = s.players.length > 1 ? `${p.name} · ${p.score}` : `${p.name} · best ${p.score}`;
      if (s.phase === "turn" && i === s.turn) el.className = "now";
      else if (s.phase !== "spun" && s.alive && !s.alive[i]) el.className = "out";
      chips.append(el);
    });
    const ev = $("catEvent");
    if (s.event) {
      const name = s.players[s.event.who]?.name || "Someone";
      ev.textContent = s.event.kind === "out" ? `${name} stalled and is out.` : s.event.kind === "win" ? `${name} wins the round! ${s.event.n} answers in all.` : `Round over: ${s.event.n} answer${s.event.n === 1 ? "" : "s"}.`;
      ev.hidden = false;
    } else ev.hidden = true;
    const turn = s.phase === "turn";
    $("gotOne").hidden = !(controls && turn); $("stuck").hidden = !(controls && turn);
    $("spunRow").hidden = !(controls && s.phase === "spun");
    $("overRow").hidden = !(controls && s.phase === "roundover");
  }

  function fillNames(list) {
    const saved = list?.length ? list : ["Player 1", "Player 2"];
    $("names").textContent = "";
    saved.forEach((n) => addNameRow(n));
  }
  function addNameRow(value = "") {
    const box = $("names");
    if (box.children.length >= 8) return;
    const row = document.createElement("div"); row.className = "row";
    const input = document.createElement("input");
    input.type = "text"; input.maxLength = 24; input.value = value; input.placeholder = `Player ${box.children.length + 1}`;
    input.setAttribute("aria-label", "Player name");
    const del = document.createElement("button");
    del.type = "button"; del.className = "btn alt small"; del.textContent = "✕"; del.setAttribute("aria-label", "Remove player");
    del.addEventListener("click", () => { if (box.children.length > 1) row.remove(); });
    row.append(input, del); box.append(row);
  }
  function startCatGame() {
    const names = [...$("names").querySelectorAll("input")].map((i, k) => i.value.trim().slice(0, 24) || `Player ${k + 1}`);
    const unique = names.map((n, i) => (names.indexOf(n) === i ? n : `${n} ${i + 1}`.slice(0, 24)));
    catDo({ type: "start", names: unique, limit: +$("limit").value, hard: $("hard").checked, voice: $("voice").checked });
  }

  // ── Wiring ──────────────────────────────────────────────────────────────
  function updateStartButton() { $("start").disabled = !$("passenger").checked || !!trip; }
  if (GAME === "trivia" || GAME === "photo") {
    $("passenger").addEventListener("change", updateStartButton);
    $("start").addEventListener("click", () => startTrip(false));
    $("demo").addEventListener("click", () => startTrip(true));
    $("end").addEventListener("click", endTrip);
    $("pause").addEventListener("click", () => {
      if (!trip) return;
      trip.paused = !trip.paused;
      $("pause").textContent = trip.paused ? "Resume" : "Pause";
    });
    renderHistory();
  }
  if (GAME === "photo") {
    $("guess").addEventListener("input", () => { $("guessOut").textContent = `${$("guess").value} min`; });
    $("lock").addEventListener("click", lockGuess);
    $("skip").addEventListener("click", () => { if (trip?.round && trip.round.guess == null) cancelRound("Finding another photo…"); });
    $("nextPhoto").addEventListener("click", nextPhoto);
    for (const id of ["from", "to"]) $(id).addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("start").disabled) startTrip(false); });
  }
  if (GAME === "categories") {
    $("catLocal").addEventListener("click", () => openCat("local"));
    $("catScreen").addEventListener("click", () => openCat("screen"));
    $("catJoin").addEventListener("click", () => { $("joinBox").hidden = false; $("joinCode").focus(); });
    const joinNow = () => {
      const code = $("joinCode").value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!/^[A-HJKMNP-Z2-9]{5}$/.test(code)) return catMsg("Codes are five letters and numbers, like K7RMP.", true);
      openCat("remote", code);
    };
    $("joinGo").addEventListener("click", joinNow);
    $("joinCode").addEventListener("keydown", (e) => { if (e.key === "Enter") joinNow(); });
    $("catClose").addEventListener("click", closeCat);
    $("addName").addEventListener("click", () => addNameRow());
    $("catStart").addEventListener("click", startCatGame);
    $("go").addEventListener("click", () => catDo({ type: "go" }));
    $("respin").addEventListener("click", () => catDo({ type: "respin" }));
    $("gotOne").addEventListener("click", () => { navigator.vibrate?.(30); if (cat?.state) catDo({ type: "got", step: cat.state.step }); });
    $("stuck").addEventListener("click", () => { if (cat?.state) catDo({ type: "out", step: cat.state.step }); });
    $("nextRound").addEventListener("click", () => catDo({ type: "next" }));
    $("editPlayers").addEventListener("click", () => { fillNames(cat?.state?.players?.map((p) => p.name)); catDo({ type: "edit" }); });
    // Links to a car screen carry its code: /games/road-trip/categories/?join=K7RMP
    const joinParam = new URLSearchParams(location.search).get("join");
    if (joinParam) { $("joinBox").hidden = false; $("joinCode").value = joinParam.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5); }
  }
})();
