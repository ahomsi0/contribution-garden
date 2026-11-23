import assert from "node:assert/strict";
import test from "node:test";
import { useGardenStore } from "@/lib/garden-store";

test("the garden store starts without a username", () => {
  assert.equal(useGardenStore.getInitialState().username, "");
});

test("resetGarden clears per-garden state and keeps preferences", () => {
  const store = useGardenStore.getState();
  store.setStatus("ready");
  store.setTimeline(40);
  store.setPlaying(true);
  store.setFlythrough(true);
  store.setSelected({ id: "x", kind: "tree", title: "Tree" });
  store.setSeason("winter");
  store.setWeather("snow");
  useGardenStore.setState({ data: {} as never, error: "boom" });

  useGardenStore.getState().resetGarden();

  const next = useGardenStore.getState();
  assert.equal(next.data, null);
  assert.equal(next.status, "idle");
  assert.equal(next.error, null);
  assert.equal(next.selected, null);
  assert.equal(next.timeline, 100);
  assert.equal(next.isPlaying, false);
  assert.equal(next.isFlythrough, false);
  assert.equal(next.season, "winter");
  assert.equal(next.weather, "snow");
});
