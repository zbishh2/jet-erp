/**
 * Kiwiplan Gateway Client
 *
 * HTTP client for the on-prem Kiwiplan gateway service.
 * Connects via Cloudflare Tunnel (or localhost for dev).
 */

// Response types from the gateway
export interface KiwiplanHealthResponse {
  status: string
  devMode: boolean
  testCompanyId?: number
  timestamp: string
}

export interface KiwiplanQuote {
  quoteId: number
  quoteNumber: string
  customerName: string | null
  quoteDate: string
  status: string
  validUntil: string | null
  companyID: number
}

export interface KiwiplanQuoteDetail extends KiwiplanQuote {
  comments: string | null
  headercomments: string | null
  footercomments: string | null
  products: KiwiplanProductDesign[]
}

export interface KiwiplanProductDesign {
  productDesignId: number
  designNumber: string
  description: string | null
  internalLength: number | null
  internalWidth: number | null
  internalDepth: number | null
  finishedLength: number | null
  finishedWidth: number | null
  finishedArea: number | null
  status: string
  companyID: number
}

export interface KiwiplanCustomer {
  customerId: number
  customerNumber: string
  name: string
  isCustomer: number
  isSupplier: number
}

export interface KiwiplanCustomerDetail {
  customerId: number
  customerNumber: string
  name: string
  comments: string | null
  quickcode: string | null
  status: string
}

export interface KiwiplanCostRule {
  ruleId: number
  ruleName: string
  accountName: string | null
  costFormula: string | null
  priceFormula: string | null
  conditionExpression: string | null
  variableAmount: string | null
  fixedAmount: string | null
  activedate: string
  expirydate: string | null
}

export interface KiwiplanCostEstimate {
  estimateId: number
  productDesignID: number
  fullCost: number | null
  materialCost: number | null
  labourCost: number | null
  freightCost: number | null
  otherDirectCost: number | null
  otherIndirectCost: number | null
  costingDate: string | null
  quantity: number | null
}

// Reference data types
export interface KiwiplanBoardGrade {
  boardId: number
  code: string
  description: string | null
  density: number | null
  thickness: number | null
  costPerArea: number | null
  isObsolete: number
  basicBoardName: string | null
}

export interface KiwiplanInk {
  inkId: number
  code: string
  description: string | null
  isCoating: number
  colorGroup: string | null
  mapCode: string | null
  isObsolete: number
  coatingTypeName: string | null
}

export interface KiwiplanStyle {
  styleId: number
  code: string
  description: string | null
  status: string | null
  analysisGroup: string | null
  imageName: string | null
  unitDescription: string | null
}

export interface KiwiplanPlantRate {
  rateId: number
  machineNumber: number | null
  costRate: number | null
  priceRate: number | null
  activeDate: string
  expiryDate: string | null
  costRuleName: string | null
  plantName: string | null
}

export interface KiwiplanAddress {
  addressId: number
  street: string | null
  city: string | null
  state: string | null
  zipcode: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
  isshiptodefault: number
  deliveryRegionID: number | null
  standardDespatchModeID: number | null
}

export interface KiwiplanFreightZone {
  freightZoneId: number
  journeydistance: number | null
  journeyduration: number | null
  freightper: number | null
  fullloadfreightcharge: number | null
  partloadfreightcharge: number | null
  fromAddressID: number | null
}

export interface KiwiplanDespatchMode {
  despatchModeId: number
  name: string
  iscustomerpickup: number
}

export interface KiwiplanRouteStep {
  machineno: number
  machinename: string | null
  machinegroup: string | null
  sequencenumber: number
  routingstdrunrate: number | null
  costingstdrunrate: number | null
  routingstdsetupmins: number | null
  costingstdsetupmins: number | null
  inkcount: number | null
  routingcrew: number | null
  costingcrew: number | null
}

// Sales dashboard types
export interface SalesMonthlySummary {
  month: string
  totalSales: number
  totalMSF: number
  totalCost: number
  invoiceCount: number
}

export interface SalesByRep {
  repName: string | null
  totalSales: number
  totalMSF: number
  totalCost: number
}

export interface SalesByCustomer {
  customerName: string
  repName: string | null
  totalSales: number
  totalMSF: number
  totalCost: number
  invoiceCount: number
}

export interface SalesRep {
  contactId: number
  repName: string
}

// Paginated list response
interface ListResponse<T> {
  data: T[]
  page: number
  pageSize: number
}

// Single item response
interface ItemResponse<T> {
  data: T
}

// Error response
interface ErrorResponse {
  error: string
}

// Client configuration
export interface KiwiplanClientConfig {
  baseUrl: string
  serviceToken: string
}

/**
 * Kiwiplan Gateway Client
 *
 * Usage:
 * ```ts
 * const client = createKiwiplanClient({
 *   baseUrl: env.KIWIPLAN_GATEWAY_URL,
 *   serviceToken: env.KIWIPLAN_SERVICE_TOKEN,
 * })
 *
 * const health = await client.health()
 * const quotes = await client.listQuotes({ companyId: 123 })
 * ```
 */
export function createKiwiplanClient(config: KiwiplanClientConfig) {
  const { baseUrl, serviceToken } = config

  async function request<T>(
    path: string,
    options: { params?: Record<string, string | number | undefined> } = {}
  ): Promise<T> {
    // Build URL with query params
    const url = new URL(path, baseUrl)
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value))
        }
      }
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
      },
    })

    const data = await response.json()

    if (!response.ok) {
      const error = data as ErrorResponse
      throw new KiwiplanError(error.error || 'Unknown error', response.status)
    }

    return data as T
  }

  async function postRequest<T>(
    path: string,
    body: unknown
  ): Promise<T> {
    const url = new URL(path, baseUrl)

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const data = await response.json()

    if (!response.ok) {
      const error = data as ErrorResponse
      throw new KiwiplanError(error.error || 'Unknown error', response.status)
    }

    return data as T
  }

  return {
    /**
     * Execute a raw SQL query against the ESP database.
     * The gateway validates that it's a read-only SELECT.
     * Use this for new queries so the gateway never needs redeployment.
     */
    async rawQuery<T = Record<string, unknown>>(
      sql: string,
      params?: Record<string, unknown>
    ): Promise<{ data: T[] }> {
      return postRequest<{ data: T[] }>('/query', { sql, params })
    },

    /**
     * Health check - no auth required
     */
    async health(): Promise<KiwiplanHealthResponse> {
      const url = new URL('/health', baseUrl)
      const response = await fetch(url.toString())
      return response.json()
    },

    /**
     * List quotes with pagination
     */
    async listQuotes(params: {
      companyId: number
      page?: number
      pageSize?: number
    }): Promise<ListResponse<KiwiplanQuote>> {
      return request<ListResponse<KiwiplanQuote>>('/quotes', {
        params: {
          companyId: params.companyId,
          page: params.page,
          pageSize: params.pageSize,
        },
      })
    },

    /**
     * Get single quote with product designs
     */
    async getQuote(
      quoteId: number,
      params: { companyId: number }
    ): Promise<ItemResponse<KiwiplanQuoteDetail>> {
      return request<ItemResponse<KiwiplanQuoteDetail>>(`/quotes/${quoteId}`, {
        params: { companyId: params.companyId },
      })
    },

    /**
     * List customers with pagination and search
     */
    async listCustomers(params: {
      companyId: number
      page?: number
      pageSize?: number
      search?: string
    }): Promise<ListResponse<KiwiplanCustomer>> {
      return request<ListResponse<KiwiplanCustomer>>('/customers', {
        params: {
          companyId: params.companyId,
          page: params.page,
          pageSize: params.pageSize,
          search: params.search,
        },
      })
    },

    /**
     * Get single customer details
     */
    async getCustomer(
      customerId: number,
      params: { companyId: number }
    ): Promise<ItemResponse<KiwiplanCustomerDetail>> {
      return request<ItemResponse<KiwiplanCustomerDetail>>(
        `/customers/${customerId}`,
        { params: { companyId: params.companyId } }
      )
    },

    /**
     * Get all active cost rules (system-wide, no companyId needed)
     */
    async getCostRules(): Promise<{ data: KiwiplanCostRule[]; count: number }> {
      return request<{ data: KiwiplanCostRule[]; count: number }>(
        '/costing/rules'
      )
    },

    /**
     * Get cost estimate for a product design
     */
    async getCostEstimate(
      productDesignId: number,
      params: { companyId: number }
    ): Promise<ItemResponse<KiwiplanCostEstimate>> {
      return request<ItemResponse<KiwiplanCostEstimate>>(
        `/costing/estimate/${productDesignId}`,
        { params: { companyId: params.companyId } }
      )
    },

    /**
     * List board grades (system-wide reference data)
     */
    async listBoardGrades(): Promise<{ data: KiwiplanBoardGrade[] }> {
      return request<{ data: KiwiplanBoardGrade[] }>('/boards')
    },

    /**
     * List inks/colors (system-wide reference data)
     */
    async listInks(): Promise<{ data: KiwiplanInk[] }> {
      return request<{ data: KiwiplanInk[] }>('/inks')
    },

    /**
     * List box styles (system-wide reference data)
     */
    async listStyles(): Promise<{ data: KiwiplanStyle[] }> {
      return request<{ data: KiwiplanStyle[] }>('/styles')
    },

    /**
     * List plant/machine rates (system-wide reference data)
     */
    async listPlantRates(): Promise<{ data: KiwiplanPlantRate[] }> {
      return request<{ data: KiwiplanPlantRate[] }>('/rates')
    },

    /**
     * List addresses for a customer
     */
    async listCustomerAddresses(customerId: number): Promise<{ data: KiwiplanAddress[] }> {
      return request<{ data: KiwiplanAddress[] }>('/addresses', {
        params: { customerId },
      })
    },

    /**
     * Get freight zone for a delivery region
     */
    async getFreightZone(deliveryRegionId: number): Promise<{ data: KiwiplanFreightZone | null }> {
      return request<{ data: KiwiplanFreightZone | null }>('/addresses/freight-zone', {
        params: { deliveryRegionId },
      })
    },

    /**
     * Get despatch mode details
     */
    async getDespatchMode(despatchModeId: number): Promise<{ data: KiwiplanDespatchMode }> {
      return request<{ data: KiwiplanDespatchMode }>(`/addresses/despatch-mode/${despatchModeId}`)
    },

    /**
     * Get machine routing for a product design
     */
    async getRouting(
      productDesignId: number,
      params: { companyId: number }
    ): Promise<{ data: KiwiplanRouteStep[] }> {
      return request<{ data: KiwiplanRouteStep[] }>('/routing', {
        params: { productDesignId, companyId: params.companyId },
      })
    },

    /**
     * Get machine routing from the most recent product design for a box style
     */
    async getRoutingByStyle(
      styleId: number,
      params: { companyId: number }
    ): Promise<{ data: KiwiplanRouteStep[] }> {
      return request<{ data: KiwiplanRouteStep[] }>('/routing/by-style', {
        params: { styleId, companyId: params.companyId },
      })
    },

    /**
     * Explore schema - list columns for a table
     */
    async getTableColumns(tableName: string): Promise<{ data: Array<{ columnName: string; dataType: string; isNullable: string; maxLength: number | null }> }> {
      return request('/schema/columns', { params: { tableName } })
    },

    /**
     * Explore schema - find tables by pattern
     */
    async findTables(pattern: string): Promise<{ data: Array<{ tableName: string; schemaName: string }> }> {
      return request('/schema/tables', { params: { pattern } })
    },

    /**
     * Get monthly sales summary for a date range
     */
    async getSalesMonthlySummary(
      startDate: string,
      endDate: string
    ): Promise<{ data: SalesMonthlySummary[] }> {
      return request<{ data: SalesMonthlySummary[] }>('/sales/monthly-summary', {
        params: { startDate, endDate },
      })
    },

    /**
     * Get sales aggregated by rep for a date range
     */
    async getSalesByRep(
      startDate: string,
      endDate: string
    ): Promise<{ data: SalesByRep[] }> {
      return request<{ data: SalesByRep[] }>('/sales/by-rep', {
        params: { startDate, endDate },
      })
    },

    /**
     * Get sales aggregated by customer for a date range
     */
    async getSalesByCustomer(
      startDate: string,
      endDate: string,
      limit?: number
    ): Promise<{ data: SalesByCustomer[] }> {
      return request<{ data: SalesByCustomer[] }>('/sales/by-customer', {
        params: { startDate, endDate, limit },
      })
    },

    /**
     * Get list of distinct sales reps for filter dropdowns
     */
    async getSalesReps(): Promise<{ data: SalesRep[] }> {
      return request<{ data: SalesRep[] }>('/sales/reps')
    },
  }
}

/**
 * Error class for Kiwiplan API errors
 */
export class KiwiplanError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message)
    this.name = 'KiwiplanError'
  }
}

/**
 * Check if Kiwiplan client is configured
 */
export function isKiwiplanConfigured(env: {
  KIWIPLAN_GATEWAY_URL?: string
  KIWIPLAN_SERVICE_TOKEN?: string
}): boolean {
  return !!(env.KIWIPLAN_GATEWAY_URL && env.KIWIPLAN_SERVICE_TOKEN)
}
