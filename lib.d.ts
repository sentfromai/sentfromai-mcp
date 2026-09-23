import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

export declare const VERSION: string
export declare const DEFAULT_BASE_URL: string

export interface ToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: {
    title: string
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: boolean
  }
}
export declare const TOOLS: ToolDefinition[]

export declare class ApiError extends Error {
  status: number
  body: string
  constructor(status: number, body: string, method: string, path: string)
}

export type Api = (method: string, path: string, body?: unknown) => Promise<unknown>

export interface ClientOptions {
  /** Tenant bearer token (sf_live_…) or any token the REST API accepts. */
  apiKey: string
  /** REST API origin. Default https://api.sentfrom.ai */
  baseUrl?: string
  /** Override fetch (e.g. call an in-process app instead of the network). */
  fetchImpl?: typeof fetch
}

export declare function createApi(options: ClientOptions): Api
export declare function callTool(api: Api, name: string, args?: Record<string, unknown>): Promise<unknown>
/** An MCP Server exposing the 21 SentFromAI tools, bound to one credential. Attach your own transport. */
export declare function createServer(options: ClientOptions): Server
