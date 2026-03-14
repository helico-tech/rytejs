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

`.use(childRouter)` copies the child's state at registration time. Later mutations to the child do not affect the parent.

### Priority rules unchanged

Single-state handlers take priority over multi-state, which take priority over wildcard. This applies regardless of whether handlers were registered directly or merged from a child router.

### Middleware ordering

The child's global middleware is appended to the parent's global middleware array in the order `.use()` is called. State-scoped middleware from the child is merged with the parent's state-scoped middleware for the same state.

### `.use()` type signature

```ts
use(
  middlewareOrRouter:
    | ((ctx: Context<TConfig, TDeps>, next: () => Promise<void>) => Promise<void>)
    | WorkflowRouter<TConfig, TDeps>
): this
```

One `instanceof WorkflowRouter` check determines the code path. Functions go to the global middleware array (existing behavior). Routers trigger an eager merge.

## Implementation

### Changes to `WorkflowRouter`

1. Expand `.use()` to accept `WorkflowRouter` instances
2. Add a private `merge(child: WorkflowRouter)` method that copies:
   - `child.globalMiddleware` → appended to `this.globalMiddleware`
   - `child.singleStateBuilders` → merged into `this.singleStateBuilders`
   - `child.multiStateBuilders` → merged into `this.multiStateBuilders`
   - `child.wildcardHandlers` → merged into `this.wildcardHandlers`

### Changes to `StateBuilder`

None needed — handlers and middleware are already `readonly` arrays/maps accessible within the package.

### Merging state builders

When both parent and child have a `StateBuilder` for the same state:
- The child's handlers are merged into the parent's builder (later registration wins, matching existing `.state()` additive behavior)
- The child's state-scoped middleware is appended to the parent's

When only the child has a builder for a state, it is copied to the parent.

## Testing

1. Child router's handlers are callable through parent after `.use()`
2. Middleware from child runs in correct order (parent global → child global → state → inline → handler)
3. Eager: mutations to child after `.use()` do not affect parent
4. Priority: parent's direct handlers take priority over merged child handlers for the same state+command
5. Nested composition: router.use(a) where a.use(b) — b's handlers are reachable
6. Wildcard handlers from child are merged
7. Multi-state handlers from child are merged
8. State-scoped middleware from child is merged
9. Multiple children can be composed into one parent

## Documentation updates

- Add "Composable Routers" section to the routing-commands guide
- Update API reference with new `.use()` signature
- Add an example showing modular handler organization
