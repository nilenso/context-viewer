import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface ComponentsViewProps {
  componentMapping?: Record<string, string>;
}

export function ComponentsView({ componentMapping }: ComponentsViewProps) {
  if (!componentMapping || Object.keys(componentMapping).length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        <p>No component mapping available yet.</p>
        <p className="text-sm mt-2">
          Component mapping will appear here after processing.
        </p>
      </div>
    );
  }

  // Group by component
  const componentGroups = Object.entries(componentMapping).reduce(
    (acc, [id, component]) => {
      if (!acc[component]) {
        acc[component] = [];
      }
      acc[component].push(id);
      return acc;
    },
    {} as Record<string, string[]>
  );

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <div className="mb-4">
          <h3 className="text-lg font-semibold mb-2">Components</h3>
          <p className="text-sm text-muted-foreground">
            {Object.keys(componentGroups).length} components identified
          </p>
        </div>

        {Object.entries(componentGroups).map(([component, ids]) => (
          <Card key={component} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <h4 className="font-semibold text-base">{component}</h4>
              <Badge variant="secondary">{ids.length}</Badge>
            </div>
            <div className="space-y-1">
              {ids.map((id) => (
                <div
                  key={id}
                  className="text-xs font-mono text-muted-foreground py-1 px-2 bg-muted rounded"
                >
                  {id}
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </ScrollArea>
  );
}
