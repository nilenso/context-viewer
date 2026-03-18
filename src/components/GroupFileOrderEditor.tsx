import { useState, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { GripVertical, X, AlertTriangle } from "lucide-react";

interface SourceConversation {
  id: string;
  filename: string;
  title?: string;
}

interface GroupFileOrderEditorProps {
  memberFiles: SourceConversation[];
  onApply: (newSources: SourceConversation[]) => void;
}

function SortableItem({
  item,
  onRemove,
}: {
  item: SourceConversation;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 border rounded-md bg-background ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      <div
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </div>
      <span className="flex-1 text-sm truncate">
        {item.title || item.filename}
      </span>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        className="text-muted-foreground hover:text-destructive"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function GroupFileOrderEditor({
  memberFiles,
  onApply,
}: GroupFileOrderEditorProps) {
  const [items, setItems] = useState<SourceConversation[]>(() => [...memberFiles]);

  // Sync when memberFiles changes externally
  useEffect(() => {
    setItems([...memberFiles]);
  }, [memberFiles]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setItems((prev) => {
        const oldIndex = prev.findIndex((item) => item.id === active.id);
        const newIndex = prev.findIndex((item) => item.id === over.id);
        return arrayMove(prev, oldIndex, newIndex);
      });
    }
  };

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const hasChanges = useCallback(() => {
    if (items.length !== memberFiles.length) return true;
    return items.some((item, i) => item.id !== memberFiles[i]?.id);
  }, [items, memberFiles]);

  const willDissolve = items.length <= 1;

  return (
    <div className="space-y-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {items.map((item) => (
            <SortableItem
              key={item.id}
              item={item}
              onRemove={handleRemove}
            />
          ))}
        </SortableContext>
      </DndContext>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-2">
          No files remaining
        </p>
      )}
      {willDissolve && items.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            With {items.length} file remaining, the group will be dissolved.
          </span>
        </div>
      )}
      {hasChanges() && (
        <div className="flex justify-end gap-2 pt-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setItems([...memberFiles])}
          >
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => onApply(items)}
            disabled={items.length === 0}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
