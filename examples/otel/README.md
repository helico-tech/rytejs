# OpenTelemetry Example

Demonstrates `@rytejs/core/http` and `@rytejs/otel` working together with a full OpenTelemetry observability stack. Every workflow command dispatch is automatically traced and metered by the OTEL plugin.

## Stack

| Service        | Port  | Purpose                          |
| -------------- | ----- | -------------------------------- |
| App (Node.js)  | 3000  | Order workflow HTTP API          |
| OTel Collector | 4318  | Receives OTLP, fans out to backends |
| Jaeger         | 16686 | Distributed trace UI             |
| Prometheus     | 9090  | Metrics storage and query        |
| Grafana        | 3001  | Dashboards (admin / admin)       |

## Prerequisites

- Docker and Docker Compose
- Node.js >= 18
- pnpm

## Quick start

```bash
# Start the observability stack
docker compose up -d

# Install dependencies and start the app
pnpm install
pnpm start
```

## Example: full order lifecycle

```bash
# 1. Create a draft order
curl -s -X PUT http://localhost:3000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"initialState":"Draft","data":{"items":[{"sku":"BOOK-1","name":"Ryte in Action","quantity":1,"priceInCents":2999}]}}' | jq

# 2. Place the order
curl -s -X POST http://localhost:3000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"type":"Place","payload":{"customerEmail":"alice@example.com"}}' | jq

# 3. Pay
curl -s -X POST http://localhost:3000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"type":"Pay","payload":{"transactionId":"txn_abc123"}}' | jq

# 4. Ship
curl -s -X POST http://localhost:3000/order/order-1 \
  -H "Content-Type: application/json" \
  -d '{"type":"Ship","payload":{"trackingNumber":"TRACK-42"}}' | jq

# 5. Inspect final state
curl -s http://localhost:3000/order/order-1 | jq
```

After running commands, open the UIs to see telemetry data:

- **Jaeger** — http://localhost:16686 — search for service `ryte-otel-example`
- **Prometheus** — http://localhost:9090 — query `ryte_*` metrics
- **Grafana** — http://localhost:3001 — Prometheus and Jaeger datasources are auto-provisioned

## Teardown

```bash
docker compose down
```
