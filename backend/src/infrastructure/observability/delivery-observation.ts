import { technicalMetrics, type Stage } from "./metrics.js";
import { StructuredLogger } from "./structured-logger.js";
import { queueTrace, traceContext, uuid } from "./trace-context.js";

export function observeDelivery<T>(
  headers: unknown,
  messageId: unknown,
  stage: Stage,
  operation: () => Promise<T>,
) {
  return traceContext.run(queueTrace(headers, messageId), () =>
    technicalMetrics.measure(stage, async () => {
      const logger = new StructuredLogger(stage);
      logger.log({
        event: "pipeline.delivery.started",
        event_id: uuid(messageId),
      });
      try {
        const result = await operation();
        logger.log({
          event: "pipeline.delivery.returned",
          event_id: uuid(messageId),
        });
        return result;
      } catch (error) {
        logger.error({
          event: "pipeline.delivery.interrupted",
          event_id: uuid(messageId),
        });
        throw error;
      }
    }),
  );
}
