# HTTP API

One function turns your executor into an HTTP API.

## createFetch

`createFetch` takes a map of named executors and a store, and returns a `(Request) => Promise<Response>` function compatible with any Web Standard API server:

<<< @/snippets/guide/http-api.ts#create-fetch

## Route Mapping

| Method | Path | Action |
| --- | --- | --- |
| `PUT` | `/:name/:id` | Create workflow |
| `POST` | `/:name/:id` | Execute command |
| `GET` | `/:name/:id` | Load workflow |

## Error-to-Status Mapping

Executor and dispatch errors map to HTTP status codes:

| Error Category | Status | Meaning |
| --- | --- | --- |
| `not_found` | 404 | Workflow doesn't exist |
| `conflict` | 409 | Version mismatch (optimistic locking) |
| `already_exists` | 409 | Duplicate create |
| `validation` | 400 | Invalid command payload |
| `router` | 400 | No handler for command in current state |
| `domain` | 422 | Business rule violation |
| `dependency` | 503 | External dependency failure |
| `restore` | 500 | Snapshot restore failed |
| `unexpected` | 500 | Handler threw unexpectedly |

## Multiple Workflow Types

Pass multiple executors to serve different workflow types from a single endpoint:

<<< @/snippets/guide/http-api.ts#multiple-executors

## Framework Integration

`createFetch` returns a standard `(Request) => Promise<Response>` — it works with any framework that supports the Fetch API:

| Runtime | Integration |
| --- | --- |
| **Bun** | `Bun.serve({ fetch })` |
| **Deno** | `Deno.serve(fetch)` |
| **Hono** | `app.all("/task/*", (c) => fetch(c.req.raw))` |
| **Express** | Use `@hono/node-server` or similar adapter to bridge `(req, res)` to `(Request) => Response` |

<<< @/snippets/guide/http-api.ts#hono-integration
