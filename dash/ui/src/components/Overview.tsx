import { useMemo } from "react";
import { Data, NewPin, allEvents, dayKey, hhmm, todayKey } from "../data";
import type { Store } from "../store";
import { DayCounterStrip, GoalsBoard, NotebookDeck, ObservationsCard, PinWall, VitalsStrip } from "./gaze";

/**
 * Gaze — the workspace.
 *   days written + the notebook on the desk
 *   today's numbers (vitals strip)
 *   the goals board (sticky notes on cork)
 *   the pin wall (posters)
 *   the Watcher's observations
 */
export function Overview({ data, store, onAddPin, onDeletePin, onOrderPins, opening, onOpenNotebook, notebookStats, demo }: {
  data: Data;
  store: Store;
  onAddPin: (p: NewPin) => Promise<void>;
  onDeletePin: (id: number) => Promise<void>;
  onOrderPins: (ids: number[]) => Promise<void>;
  opening: boolean;
  onOpenNotebook: () => void;
  notebookStats: { pages: number; apples: number };
  demo: boolean;
}) {
  const todayLines = useMemo(() => {
    const t = todayKey();
    return allEvents(data).filter((e) => dayKey(e.at) === t).reverse().map((e) => ({ at: hhmm(e.at), text: e.title }));
  }, [data]);
  return (
    <>
      <DayCounterStrip data={data}
        deck={<NotebookDeck pages={notebookStats.pages} apples={notebookStats.apples} lines={todayLines} opening={opening} onOpen={onOpenNotebook} />} />
      <VitalsStrip data={data} />
      <GoalsBoard store={store} />
      <PinWall pins={data.pins} onAdd={onAddPin} onDelete={onDeletePin} onOrder={onOrderPins} demo={demo}
        upload={store.uploads ? (f) => store.upload(f).then((u) => u.url) : undefined} />
      <ObservationsCard data={data} />
    </>
  );
}
