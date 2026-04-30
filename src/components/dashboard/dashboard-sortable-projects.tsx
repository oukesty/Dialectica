"use client";

import { useState } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

interface SortableItem {
  id: string;
  content: React.ReactNode;
}

function SortableRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-0">
      <button type="button" className="flex w-8 shrink-0 cursor-grab items-center justify-center rounded-l-2xl border border-r-0 border-[color:var(--border)] bg-[color:var(--surface-muted)] text-[color:var(--muted)] active:cursor-grabbing" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function SortableProjectList({
  items,
  onReorder,
}: {
  items: SortableItem[];
  onReorder: (newOrder: string[]) => void;
}) {
  const [order, setOrder] = useState(items.map((i) => i.id));
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const sorted = order.map((id) => items.find((i) => i.id === id)).filter(Boolean) as SortableItem[];
  // Add any items not in order (new projects)
  for (const item of items) {
    if (!order.includes(item.id)) sorted.push(item);
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sorted.findIndex((i) => i.id === active.id);
    const newIndex = sorted.findIndex((i) => i.id === over.id);
    const newSorted = arrayMove(sorted, oldIndex, newIndex);
    const newIds = newSorted.map((i) => i.id);
    setOrder(newIds);
    onReorder(newIds);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={sorted.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-4">
          {sorted.map((item) => (
            <SortableRow key={item.id} id={item.id}>
              {item.content}
            </SortableRow>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
