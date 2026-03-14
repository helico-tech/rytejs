# Composable Routers

## Problem

Handler registration is monolithic. All `.state()` and `.on()` calls must target the same router instance. There's no way to group related handlers into reusable units or organize them across files and compose them.

## Solution

Make `WorkflowRouter` composable by allowing `.use()` to accept another `WorkflowRouter`. When a router is passed, its state builders, wildcard handlers, and global middleware are eagerly merged into the parent — as if `.state()` and `.on()` had been called directly on the parent.

## API

```ts
// Define handler groups as separate routers
const draftRouter = new WorkflowRouter(taskWorkflow);
draftRouter.state("Draft", (state) => {
  state.on("SetTitle", (ctx) => { ... });
  state.on("Submit", (ctx) => { ... });
});

const reviewRouter = new WorkflowRouter(taskWorkflow);
reviewRouter.state("Review", (state) => {
  state.on("Approve", (ctx) => { ... });
  state.on("Reject", (ctx) => { ... });
});

// Compose into a parent router
const router = new WorkflowRouter(taskWorkflow);
router.use(draftRouter);
router.use(reviewRouter);

// Nested composition
const editingRouter = new WorkflowRouter(taskWorkflow);
editingRouter.use(draftRouter);

const app = new WorkflowRouter(taskWorkflow);
app.use(editingRouter);
app.use(reviewRouter);
```

## Behavior

### Eager merge

`.use(childRouter)` copies the child's handlers and middleware entries (not references) into the parent at registration time. Later mutations to the child do not affect the parent. The child remains fully usable after merge — it can be `.use()`'d into multiple parents or continue to have handlers registered on it for direct dispatch.

### Definition validation

`.use(childRouter)` throws if the child was constructed with a different `WorkflowDefinition` (reference equality check). This prevents silently merging handlers that reference incompatible states, commands, or schemas.

### Dependencies

The child's `deps` are discarded during merge. Merged handlers execute in the parent's dispatch context and receive the parent's `deps`. This is the correct behavior — after merge, the handlers belong to the parent.

### Handler conflict resolution: parent wins

When both parent and child have a handler for the same state + command, the parent's handler is kept. Child handlers are only copied if no handler exists for that state + command in the parent. This applies to single-state handlers, multi-state handlers, and wildcard handlers consistently.

This matches the intuition that explicit registrations on the parent take precedence over composed children. Think of `.use(child)` as "fill in what's missing."

### Priority rules unchanged

Single-state handlers take priority over multi-state, which take priority over wildcard. This applies regardless of whether handlers were registered directly or merged from a child router.

### Middleware ordering

The child's global middleware is appended to the parent's global middleware array in the order `.use()` is called. State-scoped middleware from the child is appended after the parent's state-scoped middleware for the same state.

Concrete example:

```ts
parent.use(parentGlobalMW);
child.use(childGlobalMW);
parent.state("Draft", (s) => s.use(parentStateMW));
child.state("Draft", (s) => s.use(childStateMW));
parent.use(child);
```

Execution order: `parentGlobalMW → childGlobalMW → parentStateMW → childStateMW → inline → handler`

Multiple children:

```ts
parent.use(childA); // childA has globalMW_A
parent.use(childB); // childB has globalMW_B
```

Execution order: `parentGlobal → globalMW_A → globalMW_B → state → handler`

### `.use()` type signature

```ts
use(
  middlewareOrRouter:
    | ((ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>)
    | WorkflowRouter<TConfig, TDeps>
): this
```

One `instanceof WorkflowRouter` check determines the code path. Functions go to the global middleware array (existing behavior). Routers trigger an eager merge.

Note: `instanceof` checks can fail when multiple versions of the same package are installed (npm deduplication issues). This is a standard trade-off for library code and acceptable for now.

## Implementation

### Changes to `WorkflowRouter`

1. Expand `.use()` to accept `WorkflowRouter` instances via `instanceof` check
2. Add a private `merge(child: WorkflowRouter)` method that:
   - Validates definition match (reference equality, throws on mismatch)
   - Copies entries from `child.globalMiddleware` → appends to `this.globalMiddleware`
   - Copies entries from `child.singleStateBuilders` → merges into `this.singleStateBuilders` (parent wins on conflict)
   - Copies entries from `child.multiStateBuilders` → merges into `this.multiStateBuilders` (parent wins on conflict)
   - Copies entries from `child.wildcardHandlers` → merges into `this.wildcardHandlers` (parent wins on conflict)

### Changes to `StateBuilder`

None needed — handlers and middleware are already `readonly` arrays/maps accessible within the package.

### Merging state builders

When both parent and child have a `StateBuilder` for the same state:
- Child handlers are copied only if the parent's builder does not already have a handler for that command (parent wins)
- The child's state-scoped middleware is appended to the parent's

When only the child has a builder for a state, a new `StateBuilder` is created in the parent with copies of the child's entries.

## Testing

1. Child router's handlers are callable through parent after `.use()`
2. Middleware from child runs in correct order (parent global → child global → state → inline → handler)
3. Eager: mutations to child after `.use()` do not affect parent
4. Parent wins: parent's direct handlers take priority over merged child handlers for the same state+command
5. Nested composition: `router.use(a)` where `a.use(b)` — b's handlers are reachable
6. Wildcard handlers from child are merged
7. Multi-state handlers from child are merged
8. State-scoped middleware from child is merged and appended after parent's state middleware
9. Multiple children can be composed into one parent
10. Multiple children's global middleware runs in `.use()` order
11. Definition mismatch throws
12. Child remains usable after merge (can be `.use()`'d into multiple parents)

## Documentation updates

- Add "Composable Routers" section to the routing-commands guide
- Update API reference with new `.use()` signature
- Add an example showing modular handler organization
