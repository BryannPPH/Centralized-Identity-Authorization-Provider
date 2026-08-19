import type { FastifyInstance, FastifyRequest } from "fastify";

type RouteMetric = {
  route: string;
  statusCode: number;
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
};

type MetricsOptions = {
  service: string;
  collect?: () => Promise<Record<string, number>>;
};

const startedAt = new Date();

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

function routeLabel(request: FastifyRequest): string {
  return request.routeOptions.url ?? request.url.split("?")[0] ?? "unknown";
}

function renderPrometheus(
  service: string,
  routes: RouteMetric[],
  customMetrics: Record<string, number>
): string {
  const lines = [
    "# HELP identity_service_uptime_seconds Service uptime in seconds.",
    "# TYPE identity_service_uptime_seconds gauge",
    `identity_service_uptime_seconds{service="${escapeLabel(service)}"} ${Math.floor(
      (Date.now() - startedAt.getTime()) / 1000
    )}`,
    "# HELP identity_http_requests_total HTTP requests grouped by route and status.",
    "# TYPE identity_http_requests_total counter"
  ];

  for (const metric of routes) {
    const labels = `service="${escapeLabel(service)}",route="${escapeLabel(
      metric.route
    )}",status="${metric.statusCode}"`;

    lines.push(`identity_http_requests_total{${labels}} ${metric.count}`);
    lines.push(
      `identity_http_request_duration_ms_sum{${labels}} ${metric.totalDurationMs.toFixed(
        3
      )}`
    );
    lines.push(
      `identity_http_request_duration_ms_max{${labels}} ${metric.maxDurationMs.toFixed(
        3
      )}`
    );
    lines.push(`identity_http_errors_total{${labels}} ${metric.errorCount}`);
  }

  for (const [name, value] of Object.entries(customMetrics).sort()) {
    lines.push(`# TYPE ${name} gauge`);
    lines.push(`${name}{service="${escapeLabel(service)}"} ${value}`);
  }

  return `${lines.join("\n")}\n`;
}

function renderDashboard(
  service: string,
  routes: RouteMetric[],
  customMetrics: Record<string, number>
): string {
  const totalRequests = routes.reduce((sum, metric) => sum + metric.count, 0);
  const totalErrors = routes.reduce((sum, metric) => sum + metric.errorCount, 0);
  const totalDuration = routes.reduce(
    (sum, metric) => sum + metric.totalDurationMs,
    0
  );
  const averageLatency = totalRequests === 0 ? 0 : totalDuration / totalRequests;

  const routeRows = routes
    .map((metric) => {
      const average = metric.totalDurationMs / metric.count;

      return `<tr><td>${metric.route}</td><td>${metric.statusCode}</td><td>${metric.count}</td><td>${metric.errorCount}</td><td>${average.toFixed(2)}</td><td>${metric.maxDurationMs.toFixed(2)}</td></tr>`;
    })
    .join("");
  const customRows = Object.entries(customMetrics)
    .sort()
    .map(([name, value]) => `<tr><td>${name}</td><td>${value}</td></tr>`)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${service} metrics</title>
    <style>
      body { margin: 0; padding: 24px; font: 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #18212f; background: #f6f7f9; }
      main { max-width: 1080px; margin: 0 auto; }
      h1 { margin: 0 0 18px; font-size: 24px; }
      h2 { margin: 24px 0 10px; font-size: 16px; }
      .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
      .tile { border: 1px solid #d9dee7; border-radius: 8px; background: #fff; padding: 12px; }
      .label { color: #667085; font-size: 12px; text-transform: uppercase; }
      .value { margin-top: 6px; font-size: 22px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #d9dee7; }
      th, td { padding: 9px 10px; border-bottom: 1px solid #e6e9ef; text-align: left; }
      th { color: #667085; font-size: 12px; text-transform: uppercase; }
    </style>
  </head>
  <body>
    <main>
      <h1>${service} metrics</h1>
      <section class="summary">
        <div class="tile"><div class="label">Uptime</div><div class="value">${Math.floor((Date.now() - startedAt.getTime()) / 1000)}s</div></div>
        <div class="tile"><div class="label">Requests</div><div class="value">${totalRequests}</div></div>
        <div class="tile"><div class="label">Errors</div><div class="value">${totalErrors}</div></div>
        <div class="tile"><div class="label">Avg Latency</div><div class="value">${averageLatency.toFixed(2)}ms</div></div>
      </section>
      <h2>Routes</h2>
      <table><thead><tr><th>Route</th><th>Status</th><th>Count</th><th>Errors</th><th>Avg ms</th><th>Max ms</th></tr></thead><tbody>${routeRows}</tbody></table>
      <h2>Event Delivery</h2>
      <table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>${customRows}</tbody></table>
    </main>
  </body>
</html>`;
}

export function registerMetricsRoutes(
  app: FastifyInstance,
  options: MetricsOptions
): void {
  const starts = new WeakMap<FastifyRequest, bigint>();
  const routes = new Map<string, RouteMetric>();

  app.addHook("onRequest", (request, _reply, done) => {
    starts.set(request, process.hrtime.bigint());
    done();
  });

  app.addHook("onResponse", (request, reply, done) => {
    const start = starts.get(request);

    if (start) {
      const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      const key = `${routeLabel(request)}:${reply.statusCode}`;
      const current =
        routes.get(key) ??
        {
          route: routeLabel(request),
          statusCode: reply.statusCode,
          count: 0,
          errorCount: 0,
          totalDurationMs: 0,
          maxDurationMs: 0
        };

      current.count += 1;
      current.totalDurationMs += durationMs;
      current.maxDurationMs = Math.max(current.maxDurationMs, durationMs);

      if (reply.statusCode >= 500) {
        current.errorCount += 1;
      }

      routes.set(key, current);
    }

    done();
  });

  app.get("/metrics", async (_, reply) => {
    const customMetrics = options.collect ? await options.collect() : {};

    reply.type("text/plain; version=0.0.4; charset=utf-8");

    return renderPrometheus(options.service, [...routes.values()], customMetrics);
  });

  app.get("/metrics/dashboard", async (_, reply) => {
    const customMetrics = options.collect ? await options.collect() : {};

    reply.type("text/html; charset=utf-8");

    return renderDashboard(options.service, [...routes.values()], customMetrics);
  });
}
