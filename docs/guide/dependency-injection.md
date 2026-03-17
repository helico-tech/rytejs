# Dependency Injection

Pass external services to your handlers through the router's dependency system.

## Providing Dependencies

Pass a deps object as the second argument to `WorkflowRouter`:

<<< @/snippets/guide/dependency-injection.ts#providing

The type is inferred from the object you pass. All handlers and middleware receive the same typed `deps`.

## Accessing Dependencies

Use `deps` in any handler or middleware:

<<< @/snippets/guide/dependency-injection.ts#accessing

`deps` is fully typed -- TypeScript knows exactly what services are available.

## Complete Example

<<< @/snippets/guide/dependency-injection.ts#complete

## Testing with Mock Dependencies

Dependency injection makes testing straightforward -- pass mocks instead of real services:

<<< @/snippets/guide/dependency-injection.ts#testing
