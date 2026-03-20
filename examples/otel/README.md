# OpenTelemetry Example

Demonstrates `@rytejs/core/executor` and `@rytejs/otel` working together with a full OpenTelemetry observability stack. Every workflow command dispatch is automatically traced and metered by the OTEL middleware.

## Stack

| Service                | Port | Purpose                                         |
| ---------------------- | ---- | ----------------------------------------------- |
| App (Node.js)          | 4000 | Order workflow HTTP API                         |
| grafana/otel-lgtm      | 3000 | Grafana + OTel Collector + Prometheus + Tempo + Loki |
| (OTLP HTTP)            | 4318 | Receives traces and metrics from the app        |

Uses the [`grafana/otel-lgtm`](https://github.com/grafana/docker-otel-lgtm) all-in-one container — a single Docker image with the OTel Collector, Prometheus, Tempo, Loki, and Grafana preconfigured.

## Prerequisites

- Docker
- Node.js >= 18
- pnpm

## Quick start

```bash
# Start the observability stack (single container)
docker compose up -d

# Install dependencies and start the app
pnpm install
pnpm start
```

## Example: full order lifecycle

```bash
# 1. Create a draft order
curl -s -X PUT http://localhost:4000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"initialState":"Draft","data":{"items":[{"sku":"BOOK-1","name":"Ryte in Action","quantity":1,"priceInCents":2999}]}}' | jq

# 2. Place the order
curl -s -X POST http://localhost:4000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"type":"Place","payload":{"customerEmail":"alice@example.com"}}' | jq

# 3. Pay
curl -s -X POST http://localhost:4000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"type":"Pay","payload":{"transactionId":"txn_abc123"}}' | jq

# 4. Ship
curl -s -X POST http://localhost:4000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"type":"Ship","payload":{"trackingNumber":"TRACK-42"}}' | jq

# 5. Inspect final state
curl -s http://localhost:4000/order/order-1 | jq
```

After running commands, open **Grafana** at http://localhost:3000 (login: admin / admin):

- **Traces** — Explore → Tempo → search for service `ryte-otel-example`
- **Metrics** — Explore → Prometheus → query `ryte_dispatch_count` or `ryte_dispatch_duration`

## Teardown

```bash
docker compose down
```
