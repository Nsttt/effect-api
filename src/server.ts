import { Config, pipe, Effect as E } from "effect";
import { Schema as S } from "@effect/schema";
import {
  Api,
  ApiResponse,
  Middlewares,
  RouterBuilder,
  ServerError,
} from "effect-http";
import * as sqlite from "@effect/sql-sqlite-node";
import { NodeRuntime } from "@effect/platform-node";
import { NodeSdk } from "@effect/opentelemetry";
import {
  BatchSpanProcessor,
  ConsoleSpanExporter,
} from "@opentelemetry/sdk-trace-node";
import { NodeServer } from "effect-http-node";

const Content = S.Struct({
  content: S.String,
});
interface Content extends S.Schema.Type<typeof Content> {}

const Note = S.extend(
  S.Struct({
    id: S.Int,
  }),
  Content,
);
interface Note extends S.Schema.Type<typeof Note> {}

const Notes = S.Array(Note);
interface Notes extends S.Schema.Type<typeof Notes> {}

const NoteError = S.Struct({
  message: S.String,
  details: S.String,
});

const noteApi = pipe(
  Api.make({ title: "Néstor's Notes API" }),
  Api.addEndpoint(
    pipe(
      Api.post("createNote", "/notes"),
      Api.setRequestBody(Content),
      Api.setResponseBody(Notes),
      Api.setResponseStatus(201),
      Api.addResponse(ApiResponse.make(500, NoteError)),
    ),
  ),
  Api.addEndpoint(
    pipe(
      Api.get("getNotes", "/notes"),
      Api.setResponseBody(Notes),
      Api.addResponse(ApiResponse.make(500, NoteError)),
    ),
  ),
  Api.addEndpoint(
    pipe(
      Api.delete("deleteNotes", "/notes"),
      Api.setResponseBody(S.String),
      Api.addResponse(ApiResponse.make(500, NoteError)),
    ),
  ),
  Api.addEndpoint(
    pipe(
      Api.get("getNote", "/notes/:id"),
      Api.setRequestPath(S.Struct({ id: S.NumberFromString })),
      Api.setResponseBody(Note),
      Api.addResponse(ApiResponse.make(500, NoteError)),
    ),
  ),
  Api.addEndpoint(
    pipe(
      Api.delete("deleteNote", "/notes/:id"),
      Api.setRequestPath(S.Struct({ id: S.NumberFromString })),
      Api.setResponseBody(S.String),
      Api.addResponse(ApiResponse.make(500, NoteError)),
    ),
  ),
);

const appError = (message: string) =>
  E.mapError((e: Error) =>
    ServerError.makeJson(500, {
      message,
      details: e.message,
    }),
  );

const app = E.gen(function* () {
  const sql = yield* sqlite.client.SqliteClient;
  yield* sql`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, content TEXT UNIQUE)`;

  const CreateNote = sqlite.schema.void({
    Request: Content,
    execute: (body) => sql`INSERT INTO notes ${sql.insert(body)}`,
  });
  const GetAllNotes = sqlite.schema.findAll({
    Request: S.Void,
    Result: Note,
    execute: () => sql`SELECT * FROM notes`,
  });
  const DeleteAllNotes = sqlite.schema.void({
    Request: S.Void,
    execute: () => sql`DELETE FROM notes`,
  });
  const GetNote = sqlite.schema.single({
    Request: S.Int,
    Result: Note,
    execute: (id) => sql`SELECT * FROM notes WHERE id = ${id}`,
  });
  const DeleteNote = sqlite.schema.void({
    Request: S.Int,
    execute: (id) => sql`DELETE FROM notes WHERE id = ${id}`,
  });

  return RouterBuilder.make(noteApi).pipe(
    RouterBuilder.handle("createNote", ({ body }) =>
      E.gen(function* () {
        yield* CreateNote(body);
        const notes = yield* GetAllNotes();
        return notes;
      }).pipe(E.withSpan("createNote"), appError("Error creating note")),
    ),
    RouterBuilder.handle("getNotes", () =>
      E.gen(function* () {
        const notes = yield* GetAllNotes();
        return notes;
      }).pipe(E.withSpan("getNotes"), appError("Error getting notes")),
    ),
    RouterBuilder.handle("deleteNotes", () =>
      E.gen(function* () {
        yield* DeleteAllNotes();
        return "All notes deleted";
      }).pipe(E.withSpan("deleteNotes"), appError("Error deleting notes")),
    ),
    RouterBuilder.handle("getNote", ({ path }) =>
      E.gen(function* () {
        const note = yield* GetNote(path.id);
        return note;
      }).pipe(
        E.withSpan("getNote", { attributes: { "note.id": path.id } }),
        appError("Error getting note"),
      ),
    ),
    RouterBuilder.handle("deleteNote", ({ path }) =>
      E.gen(function* () {
        yield* DeleteNote(path.id);
        return "Note deleted";
      }).pipe(
        E.withSpan("deleteNote", { attributes: { "note.id": path.id } }),
        appError("Error deleting note"),
      ),
    ),
    RouterBuilder.build,
    Middlewares.errorLog,
  );
});

const OPTLService = NodeSdk.layer(() => ({
  resource: { serviceName: "notes" },
  spanProcessor: new BatchSpanProcessor(new ConsoleSpanExporter()),
}));

app.pipe(
  E.flatMap(NodeServer.listen({ port: 3000 })),
  E.provide(
    sqlite.client.layer({
      filename: Config.succeed("notes.db"),
    }),
  ),
  E.provide(OPTLService),
  NodeRuntime.runMain,
);
