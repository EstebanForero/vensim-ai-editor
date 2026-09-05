import { ReactFlowProvider } from "@xyflow/react";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { FlowCanvas } from "@/components/canvas/FlowCanvas";
import { SimChart } from "@/components/charts/SimChart";
import { Inspector } from "@/components/inspector/Inspector";
import { TextView } from "@/components/textview/TextView";
import { Toolbar } from "@/components/toolbar/Toolbar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useModelStore } from "@/state/modelStore";

function App() {
  const issues = useModelStore((s) => s.issues);

  return (
    <div className="flex h-screen w-screen flex-col">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <ReactFlowProvider>
          <div className="min-w-0 flex-1">
            <FlowCanvas />
          </div>
        </ReactFlowProvider>

        <aside className="flex w-96 shrink-0 flex-col border-l bg-card">
          <Tabs defaultValue="inspector" className="flex min-h-0 flex-1 flex-col">
            <TabsList className="m-2">
              <TabsTrigger value="inspector">Inspector</TabsTrigger>
              <TabsTrigger value="chat">AI Chat</TabsTrigger>
              <TabsTrigger value="sim">Simulation</TabsTrigger>
              <TabsTrigger value="text">Text</TabsTrigger>
            </TabsList>
            <TabsContent value="inspector" className="min-h-0 flex-1 overflow-y-auto">
              <Inspector />
            </TabsContent>
            <TabsContent value="chat" className="min-h-0 flex-1">
              <ChatPanel />
            </TabsContent>
            <TabsContent value="sim" className="min-h-0 flex-1">
              <SimChart />
            </TabsContent>
            <TabsContent value="text" className="min-h-0 flex-1">
              <TextView />
            </TabsContent>
          </Tabs>
        </aside>
      </div>

      {issues.length > 0 && (
        <div className="border-t bg-destructive/10 px-3 py-1 text-xs text-destructive">
          {issues.length} model issue{issues.length > 1 ? "s" : ""}: {issues[0]!.message}
        </div>
      )}
    </div>
  );
}

export default App;
