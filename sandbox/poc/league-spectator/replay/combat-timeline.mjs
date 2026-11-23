const element = (id) => document.getElementById(id);
const status = element("status");
const worker = new Worker("/combat-timeline-worker.mjs", { type: "module" });
worker.addEventListener("error", () => {
  status.textContent = "The local replay reader could not start.";
  worker.terminate();
});
worker.addEventListener("message", ({ data }) => {
  worker.terminate();
  if (data.error) {
    status.textContent = data.error;
    return;
  }
  mountTimeline(data);
});

function formatTime(seconds) {
  const millis = Math.round(seconds * 1000);
  return `${Math.floor(millis / 60000)}:${String(
    Math.floor((millis % 60000) / 1000),
  ).padStart(2, "0")}.${String(millis % 1000).padStart(3, "0")}`;
}

function mountTimeline({ build, duration, events }) {
  status.textContent = `Build ${build} · ${events.length} decoded kill and death events`;
  const seek = element("seek");
  const clock = element("clock");
  const play = element("play");
  const previous = element("previous");
  const next = element("next");
  const eventList = element("event-list");
  const empty = element("empty");
  const marks = element("marks");
  const scores = [element("team-a"), element("team-b")];
  const durationText = formatTime(duration);
  let time = 0;
  let frame = null;
  let lastStamp = null;
  let visibleCount = -1;

  seek.max = duration;
  for (const event of events) {
    if (event.kind !== "champion-kill") continue;
    const mark = document.createElement("span");
    if (event.partition === 1) mark.className = "team-b";
    mark.style.left = `${(event.timeSeconds / duration) * 100}%`;
    marks.append(mark);
  }

  function render() {
    const timeText = formatTime(time);
    seek.value = time;
    clock.textContent = `${timeText} / ${durationText}`;
    seek.setAttribute("aria-valuetext", `${timeText} of ${durationText}`);
    const upcoming = events.findIndex((event) => event.timeSeconds > time);
    const count = upcoming < 0 ? events.length : upcoming;
    previous.disabled = !events.some((event) => event.timeSeconds < time);
    next.disabled = upcoming < 0;
    if (count === visibleCount) return;
    visibleCount = count;
    const totals = [0, 0];
    for (const event of events.slice(0, count)) {
      if (event.kind === "champion-kill") totals[event.partition]++;
    }
    scores.forEach((score, index) => (score.textContent = totals[index]));
    empty.hidden = count > 0;
    eventList.replaceChildren(
      ...events
        .slice(Math.max(0, count - 12), count)
        .reverse()
        .map(eventRow),
    );
  }

  function pause() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = lastStamp = null;
    play.textContent = "Play";
  }

  function tick(stamp) {
    if (lastStamp !== null)
      time = Math.min(duration, time + (stamp - lastStamp) / 1000);
    lastStamp = stamp;
    render();
    if (time === duration) pause();
    else frame = requestAnimationFrame(tick);
  }

  function moveTo(seconds) {
    time = seconds;
    lastStamp = null;
    render();
  }

  play.addEventListener("click", () => {
    if (frame !== null) {
      pause();
      return;
    }
    if (time === duration) moveTo(0);
    play.textContent = "Pause";
    frame = requestAnimationFrame(tick);
  });
  seek.addEventListener("input", () => moveTo(seek.valueAsNumber));
  previous.addEventListener("click", () => {
    const event = events.findLast((item) => item.timeSeconds < time);
    if (event) moveTo(event.timeSeconds);
  });
  next.addEventListener("click", () => {
    const event = events.find((item) => item.timeSeconds > time);
    if (event) moveTo(event.timeSeconds);
  });

  render();
  element("timeline").hidden = false;
}

function eventRow({ kind, partition, timeSeconds, champion }) {
  const row = document.createElement("li");
  const time = document.createElement("time");
  time.dateTime = `PT${timeSeconds}S`;
  time.textContent = formatTime(timeSeconds);
  const label = document.createElement("span");
  const action = kind === "champion-kill" ? "Champion kill" : "Champion death";
  label.textContent = champion ? `${action} · ${champion}` : action;
  const team = document.createElement("strong");
  team.textContent = partition === 0 ? "Team A" : "Team B";
  if (partition === 1) team.className = "team-b";
  row.append(time, label, team);
  return row;
}
