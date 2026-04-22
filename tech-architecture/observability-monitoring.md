# 监控与可观测性方案

## 三大支柱
| 支柱 | 说明 | 工具 |
|------|------|------|
| **Metrics(指标)** | 系统性能指标(CPU/内存/QPS/延迟) | Prometheus |
| **Logs(日志)** | 应用运行日志 | ELK / Loki |
| **Traces(追踪)** | 请求链路追踪 | Jaeger / Tempo |

## 推荐技术栈

### OpenTelemetry (统一采集)
- 开源可观测性框架
- 统一采集 Metrics + Logs + Traces
- 与任何后端兼容(Prometheus, Jaeger, Grafana等)
- NestJS有官方OpenTelemetry集成

### Prometheus (指标存储)
- 时序数据库，专注指标
- 强大的查询语言(PromQL)
- 告警管理(Alertmanager)
- 与Grafana无缝集成

### Grafana (可视化)
- 统一仪表盘
- 支持多种数据源
- 告警通知
- 开源免费

## 架构图
```
┌──────────────────────────────────────────┐
│  应用服务 (NestJS)                        │
│  OpenTelemetry SDK (自动埋点)             │
└──────────────┬───────────────────────────┘
               │ OTLP
┌──────────────▼───────────────────────────┐
│  OpenTelemetry Collector                  │
│  统一接收、处理、导出                      │
└──┬──────────┬──────────┬─────────────────┘
   │          │          │
   ▼          ▼          ▼
Prometheus   Loki      Tempo/Jaeger
(指标)      (日志)     (追踪)
   │          │          │
   └──────────┴──────────┘
              │
         ┌────▼────┐
         │ Grafana  │  ← 统一可视化仪表盘
         └─────────┘
```

## 多维表格需要监控的关键指标

### 业务指标
| 指标 | 说明 |
|------|------|
| 活跃表数量 | 了解使用量 |
| 记录操作QPS | 数据变更频率 |
| WebSocket连接数 | 在线用户数 |
| 自动化执行次数/成功率 | 工作流健康度 |
| 导入导出任务数/耗时 | 功能使用情况 |

### 技术指标
| 指标 | 说明 |
|------|------|
| API响应延迟(P50/P95/P99) | 接口性能 |
| 数据库查询延迟 | 存储层性能 |
| OT操作冲突率 | 协作系统健康 |
| 内存/CPU使用率 | 资源使用 |
| 错误率(4xx/5xx) | 系统稳定性 |

## 部署方案
```
# docker-compose 监控栈
services:
  otel-collector:
    image: otel/opentelemetry-collector
  prometheus:
    image: prom/prometheus
  loki:
    image: grafana/loki
  tempo:
    image: grafana/tempo
  grafana:
    image: grafana/grafana
    ports: ["3001:3000"]
```

## 分阶段实施
1. **初期**: 基础日志( Winston/Pino ) + 简单Prometheus指标
2. **中期**: 引入OpenTelemetry + Grafana仪表盘
3. **长期**: 完整的Traces + 自定义业务指标 + 告警体系

## 参考链接
- [OpenTelemetry vs Prometheus对比](https://www.groundcover.com/blog/opentelemetry-vs-prometheus)
- [Prometheus + OpenTelemetry](https://opentelemetry.io/blog/2024/prom-and-otel/)
- [Grafana + Prometheus + OTel实践](https://bix-tech.com/observability-with-grafana-prometheus-and-opentelemetry-a-practical-guide-to-metrics-logs-and-traces/)
- [OpenTelemetry数据采集指南](https://grafana.com/blog/a-practical-guide-to-data-collection-with-opentelemetry-and-prometheus/)
