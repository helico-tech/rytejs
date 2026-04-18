---
layout: home
hero:
  name: Ryte
  text: Type-safe workflow engine for TypeScript
  image:
    src: /logo.svg
    alt: Ryte
  tagline: Define states with any Standard Schema validator. Route commands through middleware. Ship with confidence.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: API Reference
      link: /api/
features:
  - title: Fully Typed, Zero Annotations
    details: Any Standard Schema validator (Zod, Valibot, ArkType) defines your states, commands, events, and errors. TypeScript infers everything — state names, payload types, error codes — with full autocompletion. No manual type annotations needed.
  - title: Discriminated Unions
    details: Checking workflow.state narrows workflow.data automatically. error() only accepts error codes from your definition. Every handler argument is precisely typed.
  - title: Middleware Pipelines
    details: Koa-style onion model with global, state-scoped, and inline middleware. Add auth, logging, or validation without touching handlers.
  - title: Composable Routers
    details: Split handlers across files and compose them with .use(). Routers can be nested arbitrarily. Parent handlers take priority.
  - title: Domain Errors as Contract
    details: Define error codes and their data shapes upfront. Errors are part of the workflow contract, not hidden inside handlers.
  - title: Zero Validator Lock-in
    details: Pick Zod, Valibot, or ArkType — or swap between them. Core has no runtime dependency on any validator. Works on Node.js, Bun, and Deno.
---
