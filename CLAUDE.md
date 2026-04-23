# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **research and technical design documentation repository** for a multi-dimensional table product (多维表格), similar to Notion and Feishu/Lark Bitable. The goal is to build a product that replaces all internal company systems. There is **no source code** — all content is Markdown documentation written in Chinese.

All planned research (5 rounds, 20+ topics) is complete. The repo serves as a knowledge base for the upcoming implementation phase.

## Repository Structure

- `notes.md` — Master research notes, finalized technical decisions, architecture overview, and file index. **Start here** to understand the project.
- `references.md` — Curated reference links (100+ URLs)
- `product-design/` (10 files) — Feature design: views, permissions, automation, plugins, mobile, AI, filters, field types, templates
- `tech-architecture/` (19 files) — Technical design: collaboration (OT/CRDT), formula engine, performance, search, API, deployment, testing, monitoring, etc.
- `data-storage/` (3 files) — PostgreSQL JSONB data model, APITable snapshot structure, Arrow/DuckDB-WASM exploration
- `open-source-projects/` (2 files) — Comparison of APITable/NocoDB/Baserow/Teable, detailed APITable analysis

## Finalized Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React + Next.js, Canvas table rendering, HyperFormula |
| Backend | NestJS (TypeScript) |
| Database | PostgreSQL + JSONB, Redis (cache + queue) |
| Real-time Collaboration | OT (Operational Transformation, per APITable) |
| UI Components | Ant Design (table rendering is custom Canvas) |
| Search | PG native → Meilisearch (phased) |
| Testing | Vitest + Playwright |
| API | RESTful + WebSocket |
| Deployment | Private Docker initially |

## Key Architecture

Three-tier: Frontend (React/Next.js + Canvas + OT client) → API Layer (NestJS + OT server + WebSocket + automation engine) → Data Layer (PostgreSQL JSONB + Redis). Optional extensions: Meilisearch, ClickHouse, MinIO.

## Working with This Repo

- All files are Markdown in Chinese. Preserve this language convention when adding content.
- Each file is self-contained with its own heading structure and a "参考链接" (reference links) section at the end.
- Use kebab-case for file names (matching existing convention).
- `notes.md` contains the master file index — update it when adding new files.
- Technical decisions are finalized; new research should reference and build on existing conclusions rather than reopen decisions.
