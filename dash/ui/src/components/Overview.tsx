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
export function Overview({ data, store, onAddPin, onDeletePin, opening, onOpenNotebook, notebookStats, demo }: {
  data: Data;
  store: Store;
  onAddPin: (p: NewPin) => Promise<void>;
  onDeletePin: (id: number) => Promise<void>;
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
      <div className="mb-8 grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <DayCounterStrip data={data} />
        <div className="hidden justify-self-end lg:block lg:w-[380px]">
          <NotebookDeck pages={notebookStats.pages} apples={notebookStats.apples} lines={todayLines} opening={opening} onOpen={onOpenNotebook} />
        </div>
      </div>
      <VitalsStrip data={data} />
      <GoalsBoard store={store} />
      <PinWall pins={data.pins} onAdd={onAddPin} onDelete={onDeletePin} demo={demo} />
      <ObservationsCard data={data} />
    </>
  );
}
