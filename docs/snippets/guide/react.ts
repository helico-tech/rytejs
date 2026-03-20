import type {
	CommandNames,
	CommandPayload,
	ConfigOf,
	DispatchResult,
	MigrationPipeline,
	PipelineError,
	StateData,
	StateNames,
	Workflow,
	WorkflowConfig,
	WorkflowDefinition,
	WorkflowOf,
} from "@rytejs/core";
import { defineWorkflow, WorkflowRouter } from "@rytejs/core";
import type { Transport } from "@rytejs/core/transport";
import { sseTransport } from "@rytejs/core/transport";
import { z } from "zod";

// ── Declare @rytejs/react types (not a docs dependency) ─────────────────────

declare function createWorkflowStore<
	TConfig extends WorkflowConfig,
	TDeps,
	S extends StateNames<TConfig>,
>(
	router: WorkflowRouter<TConfig, TDeps>,
	initialConfig: {
		state: S;
		data: StateData<TConfig, S>;
		id?: string;
	},
	options?: WorkflowStoreOptions<TConfig>,
): WorkflowStore<TConfig>;

declare function createWorkflowContext<TConfig extends WorkflowConfig>(
	definition: WorkflowDefinition<TConfig>,
): {
	Provider: (props: { store: WorkflowStore<TConfig>; children?: unknown }) => unknown;
	useWorkflow: {
		(): UseWorkflowReturn<TConfig>;
		<R>(selector: (workflow: Workflow<TConfig>) => R, equalityFn?: (a: R, b: R) => boolean): R;
	};
};

declare function useWorkflow<TConfig extends WorkflowConfig>(
	store: WorkflowStore<TConfig>,
): UseWorkflowReturn<TConfig>;
declare function useWorkflow<TConfig extends WorkflowConfig, R>(
	store: WorkflowStore<TConfig>,
	selector: (workflow: Workflow<TConfig>) => R,
	equalityFn?: (a: R, b: R) => boolean,
): R;

interface WorkflowStore<TConfig extends WorkflowConfig> {
	getWorkflow(): Workflow<TConfig>;
	getSnapshot(): WorkflowStoreSnapshot<TConfig>;
	subscribe(listener: () => void): () => void;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;
	setWorkflow(workflow: Workflow<TConfig>): void;
	cleanup(): void;
}

interface WorkflowStoreSnapshot<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | null;
}

interface WorkflowStoreOptions<TConfig extends WorkflowConfig> {
	persist?: {
		key: string;
		storage: Storage;
		migrations?: MigrationPipeline<TConfig>;
	};
	transport?: Transport;
}

interface UseWorkflowReturn<TConfig extends WorkflowConfig> {
	readonly workflow: Workflow<TConfig>;
	readonly state: StateNames<TConfig>;
	readonly data: StateData<TConfig, StateNames<TConfig>>;
	readonly isDispatching: boolean;
	readonly error: PipelineError<TConfig> | null;
	dispatch<C extends CommandNames<TConfig>>(
		command: C,
		payload: CommandPayload<TConfig, C>,
	): Promise<DispatchResult<TConfig>>;
	match<R>(
		matchers: {
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		},
	): R;
	match<R>(
		matchers: Partial<{
			[S in StateNames<TConfig>]: (
				data: StateData<TConfig, S>,
				workflow: WorkflowOf<TConfig, S>,
			) => R;
		}>,
		fallback: (workflow: Workflow<TConfig>) => R,
	): R;
}

// ── Task workflow definition ────────────────────────────────────────────────

const taskWorkflow = defineWorkflow("task", {
	states: {
		Todo: z.object({ title: z.string(), priority: z.number().default(0) }),
		InProgress: z.object({ title: z.string(), assignee: z.string() }),
		Done: z.object({ title: z.string(), completedAt: z.coerce.date() }),
	},
	commands: {
		Start: z.object({ assignee: z.string() }),
		Complete: z.object({}),
	},
	events: {
		TaskStarted: z.object({ taskId: z.string(), assignee: z.string() }),
		TaskCompleted: z.object({ taskId: z.string() }),
	},
	errors: {
		NotAssigned: z.object({}),
	},
});

const router = new WorkflowRouter(taskWorkflow)
	.state("Todo", ({ on }) => {
		on("Start", ({ data, command, transition, emit, workflow }) => {
			transition("InProgress", {
				title: data.title,
				assignee: command.payload.assignee,
			});
			emit({
				type: "TaskStarted",
				data: { taskId: workflow.id, assignee: command.payload.assignee },
			});
		});
	})
	.state("InProgress", ({ on }) => {
		on("Complete", ({ data, transition, emit, workflow }) => {
			transition("Done", { title: data.title, completedAt: new Date() });
			emit({ type: "TaskCompleted", data: { taskId: workflow.id } });
		});
	});

type TaskConfig = ConfigOf<typeof router>;

// ── #create-store ───────────────────────────────────────────────────────────

// #region create-store
const store = createWorkflowStore(router, {
	state: "Todo",
	data: { title: "Write docs", priority: 1 },
});

// Read the current workflow
const workflow = store.getWorkflow();
console.log(workflow.state); // "Todo"

// Dispatch a command
const result = await store.dispatch("Start", { assignee: "alice" });

if (result.ok) {
	console.log(store.getWorkflow().state); // "InProgress"
}

// Subscribe to changes
const unsubscribe = store.subscribe(() => {
	const snap = store.getSnapshot();
	console.log(snap.workflow.state, snap.isDispatching);
});
// #endregion create-store

// ── #use-workflow-hook ──────────────────────────────────────────────────────

// #region use-workflow-hook
// In a React component, useWorkflow provides reactive access to the store:
//
//   function TaskView({ store }: { store: WorkflowStore<TaskConfig> }) {
//     const wf = useWorkflow(store);
//
//     return (
//       <div>
//         <p>State: {wf.state}</p>
//         <p>Dispatching: {wf.isDispatching ? "yes" : "no"}</p>
//         {wf.error && <p>Error: {wf.error.category}</p>}
//         <button onClick={() => wf.dispatch("Start", { assignee: "alice" })}>
//           Start
//         </button>
//       </div>
//     );
//   }

// The hook returns UseWorkflowReturn<TConfig> with:
declare const wfHook: UseWorkflowReturn<TaskConfig>;

wfHook.workflow; // full Workflow<TConfig>
wfHook.state; // "Todo" | "InProgress" | "Done"
wfHook.data; // union of all state data types
wfHook.isDispatching; // true while a dispatch is in flight
wfHook.error; // PipelineError | null (last dispatch error)
wfHook.dispatch("Start", { assignee: "bob" }); // returns Promise<DispatchResult>
// #endregion use-workflow-hook

// ── #match ──────────────────────────────────────────────────────────────────

// #region match
declare const wf: UseWorkflowReturn<TaskConfig>;

// Exhaustive match — every state must be handled
const label: string = wf.match({
	Todo: (data) => `Todo: ${data.title} (priority ${data.priority})`,
	InProgress: (data) => `Working: ${data.title} (${data.assignee})`,
	Done: (data) => `Done: ${data.title} at ${data.completedAt.toISOString()}`,
});

// Partial match — only handle some states, provide a fallback
const badge: string = wf.match(
	{
		InProgress: (data) => `Assigned to ${data.assignee}`,
	},
	(workflow) => `State: ${workflow.state}`,
);
// #endregion match

// ── #selector ───────────────────────────────────────────────────────────────

// #region selector
// Selector mode — only re-renders when the selected value changes:
//
//   function TaskTitle({ store }: { store: WorkflowStore<TaskConfig> }) {
//     const title = useWorkflow(store, (wf) => wf.data.title);
//     return <h1>{title}</h1>;
//   }
//
// Custom equality function for object selections:
//
//   function TaskMeta({ store }: { store: WorkflowStore<TaskConfig> }) {
//     const meta = useWorkflow(
//       store,
//       (wf) => ({ state: wf.state, id: wf.id }),
//       (a, b) => a.state === b.state && a.id === b.id,
//     );
//     return <p>{meta.state} — {meta.id}</p>;
//   }

// Type-safe: the selector receives Workflow<TConfig>
const title: string = useWorkflow(store, (w) => w.data.title);
// #endregion selector

// ── #context ────────────────────────────────────────────────────────────────

// #region context
const TaskContext = createWorkflowContext(taskWorkflow);

// Wrap your app with the Provider:
//
//   function App() {
//     const store = createWorkflowStore(router, {
//       state: "Todo",
//       data: { title: "Build feature" },
//     });
//     return (
//       <TaskContext.Provider store={store}>
//         <TaskPanel />
//       </TaskContext.Provider>
//     );
//   }

// Any descendant can access the store without prop drilling:
//
//   function TaskPanel() {
//     const wf = TaskContext.useWorkflow();
//     return <p>{wf.state}</p>;
//   }
//
//   function TaskTitle() {
//     const title = TaskContext.useWorkflow((wf) => wf.data.title);
//     return <h1>{title}</h1>;
//   }
// #endregion context

// ── #persistence ────────────────────────────────────────────────────────────

// #region persistence
const persistedStore = createWorkflowStore(
	router,
	{
		state: "Todo",
		data: { title: "Persisted task", priority: 0 },
	},
	{
		persist: {
			key: "task-workflow",
			storage: localStorage,
		},
	},
);

// After a successful dispatch, the workflow snapshot is automatically
// saved to localStorage under the key "task-workflow".
// On next page load, createWorkflowStore restores from storage
// instead of using the initial config.
// #endregion persistence

// ── #transport-store ──────────────────────────────────────────────────────

// #region transport-store
const transportInstance = sseTransport("http://localhost:3000/task");

const transportStore = createWorkflowStore(
	router,
	{
		state: "Todo",
		data: { title: "Write docs", priority: 0 },
		id: "task-1", // Required when using transport
	},
	{ transport: transportInstance },
);

// Dispatch goes through the server instead of locally
await transportStore.dispatch("Start", { assignee: "alice" });

// Incoming broadcasts update the store automatically
// #endregion transport-store

// ── #transport-cleanup ──────────────────────────────────────────────────

// #region transport-cleanup
// Unsubscribe from transport when done (e.g., React component unmount)
transportStore.cleanup();
// #endregion transport-cleanup

void unsubscribe;
void label;
void badge;
void title;
void TaskContext;
void persistedStore;
void wfHook;
void useWorkflow;
void transportStore;
