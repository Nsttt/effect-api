import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import * as Effect from "@effect/io/Effect";
import fastify from "fastify";
import { createContext } from "./context";
import { appRouter } from "./router";

const fastifyServer = fastify({
  maxParamLength: 5000,
});

fastifyServer.register(fastifyTRPCPlugin, {
  prefix: "/trpc",
  trpcOptions: { router: appRouter, createContext },
});

Effect.try({
  try: () => fastifyServer.listen({ port: 3000 }),
  catch: (err) => {
    fastifyServer.log.error(err);
    process.exit(1);
  },
});
