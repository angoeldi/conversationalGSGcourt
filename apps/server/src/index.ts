import Fastify from "fastify";
import { env } from "./config";
import { wikiRoutes } from "./routes/wikiRoutes";
import { llmRoutes } from "./routes/llmRoutes";
import { portraitRoutes } from "./routes/portraitRoutes";
import { authRoutes } from "./routes/authRoutes";
import { scenarioRoutes } from "./routes/scenarioRoutes";
import { gameRoutes } from "./routes/gameRoutes";
import { feedbackRoutes } from "./routes/feedbackRoutes";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

app.log.info(
  {
    hasOpenAI: Boolean(env.OPENAI_API_KEY),
    hasHFKey: Boolean(env.HF_API_KEY),
    hasHFUrl: Boolean(env.HF_INFERENCE_URL)
  },
  "Portrait environment status"
);

await wikiRoutes(app);
await llmRoutes(app);
await authRoutes(app);
await portraitRoutes(app);
await scenarioRoutes(app);
await gameRoutes(app);
await feedbackRoutes(app);

app.listen({ port: env.PORT, host: "0.0.0.0" })
  .then((a) => app.log.info(`Server listening at ${a}`))
  .catch((e) => {
    app.log.error(e);
    process.exit(1);
  });
