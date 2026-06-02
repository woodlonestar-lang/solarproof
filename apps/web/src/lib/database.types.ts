export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      cooperatives: {
        Row: { id: string; name: string; admin_address: string; created_at: string }
        Insert: { name: string; admin_address: string }
        Update: Partial<{ name: string; admin_address: string }>
        Relationships: []
      }
      meters: {
        Row: {
          id: string; cooperative_id: string; serial_number: string
          name: string; pubkey_hex: string; active: boolean; created_at: string
          api_key: string
        }
        Insert: { cooperative_id: string; serial_number: string; name: string; pubkey_hex: string; active: boolean; api_key?: string }
        Update: Partial<{ cooperative_id: string; serial_number: string; name: string; pubkey_hex: string; active: boolean; api_key: string }>
        Relationships: []
      }
      readings: {
        Row: {
          id: string; meter_id: string; kwh: number; timestamp: string
          reading_hash: string; signature_hex: string
          anchor_tx_hash: string | null; mint_tx_hash: string | null
          anchored: boolean; minted: boolean
          mint_diagnosis: Json | null
        }
        Insert: {
          meter_id: string; kwh: number; timestamp: string
          reading_hash: string; signature_hex: string
          anchor_tx_hash?: string | null; mint_tx_hash?: string | null
          anchored: boolean; minted: boolean
          mint_diagnosis?: Json | null
        }
        Update: Partial<{
          meter_id: string; kwh: number; timestamp: string
          reading_hash: string; signature_hex: string
          anchor_tx_hash: string | null; mint_tx_hash: string | null
          anchored: boolean; minted: boolean
          mint_diagnosis: Json | null
        }>
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          nonce: string; reading_id: string; response: Json; created_at: string
        }
        Insert: Omit<Database['public']['Tables']['idempotency_keys']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['idempotency_keys']['Insert']>
      }
      certificates: {
        Row: {
          id: string; cooperative_id: string; reading_id: string
          reading_hash: string; mint_tx_hash: string; anchor_tx_hash: string
          kwh: number; issued_at: string; retired: boolean
          retired_at: string | null; retired_by: string | null
        }
        Insert: {
          cooperative_id: string; reading_id: string
          reading_hash: string; mint_tx_hash: string; anchor_tx_hash: string
          kwh: number; issued_at: string; retired: boolean
          retired_at?: string | null; retired_by?: string | null
        }
        Update: Partial<{
          cooperative_id: string; reading_id: string
          reading_hash: string; mint_tx_hash: string; anchor_tx_hash: string
          kwh: number; issued_at: string; retired: boolean
          retired_at: string | null; retired_by: string | null
        }>
        Relationships: []
      }
      webhook_endpoints: {
        Row: {
          id: string; cooperative_id: string; url: string; secret: string
          events: string[]; active: boolean; created_at: string
        }
        Insert: Omit<Database['public']['Tables']['webhook_endpoints']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['webhook_endpoints']['Insert']>
      }
      webhook_logs: {
        Row: {
          id: string; endpoint_id: string; event: string; payload: Json
          status: string; attempts: number; response_status: number | null; created_at: string
        }
        Insert: Omit<Database['public']['Tables']['webhook_logs']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['webhook_logs']['Insert']>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
