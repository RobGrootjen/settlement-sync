export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      discrepancies: {
        Row: {
          actual_amount_minor: number | null
          created_at: string
          currency: string | null
          dataset_id: string | null
          discrepancy_type: string
          expected_amount_minor: number | null
          fingerprint: string | null
          id: string
          reason: string | null
          resolution_status: string
          resolved_at: string | null
          settlement_record_id: string | null
          severity: string
          transaction_id: string | null
          variance_amount_minor: number | null
        }
        Insert: {
          actual_amount_minor?: number | null
          created_at?: string
          currency?: string | null
          dataset_id?: string | null
          discrepancy_type: string
          expected_amount_minor?: number | null
          fingerprint?: string | null
          id?: string
          reason?: string | null
          resolution_status?: string
          resolved_at?: string | null
          settlement_record_id?: string | null
          severity?: string
          transaction_id?: string | null
          variance_amount_minor?: number | null
        }
        Update: {
          actual_amount_minor?: number | null
          created_at?: string
          currency?: string | null
          dataset_id?: string | null
          discrepancy_type?: string
          expected_amount_minor?: number | null
          fingerprint?: string | null
          id?: string
          reason?: string | null
          resolution_status?: string
          resolved_at?: string | null
          settlement_record_id?: string | null
          severity?: string
          transaction_id?: string | null
          variance_amount_minor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discrepancies_settlement_record_id_fkey"
            columns: ["settlement_record_id"]
            isOneToOne: false
            referencedRelation: "settlement_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrepancies_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ingestion_runs: {
        Row: {
          accepted_count: number
          created_at: string
          dataset_id: string | null
          errors: Json
          filename: string | null
          id: string
          processor: string | null
          record_count: number
          rejected_count: number
        }
        Insert: {
          accepted_count?: number
          created_at?: string
          dataset_id?: string | null
          errors?: Json
          filename?: string | null
          id?: string
          processor?: string | null
          record_count?: number
          rejected_count?: number
        }
        Update: {
          accepted_count?: number
          created_at?: string
          dataset_id?: string | null
          errors?: Json
          filename?: string | null
          id?: string
          processor?: string | null
          record_count?: number
          rejected_count?: number
        }
        Relationships: []
      }
      processor_fee_rules: {
        Row: {
          created_at: string
          currency: string
          fee_bps: number
          fixed_fee_minor: number
          id: string
          payment_method: string
          processor: string
          tolerance_minor: number
        }
        Insert: {
          created_at?: string
          currency: string
          fee_bps?: number
          fixed_fee_minor?: number
          id?: string
          payment_method: string
          processor: string
          tolerance_minor?: number
        }
        Update: {
          created_at?: string
          currency?: string
          fee_bps?: number
          fixed_fee_minor?: number
          id?: string
          payment_method?: string
          processor?: string
          tolerance_minor?: number
        }
        Relationships: []
      }
      reconciliation_events: {
        Row: {
          created_at: string
          dataset_id: string | null
          details: Json
          event_type: string
          id: string
          match_method: string | null
          settlement_record_id: string | null
          transaction_id: string | null
        }
        Insert: {
          created_at?: string
          dataset_id?: string | null
          details?: Json
          event_type: string
          id?: string
          match_method?: string | null
          settlement_record_id?: string | null
          transaction_id?: string | null
        }
        Update: {
          created_at?: string
          dataset_id?: string | null
          details?: Json
          event_type?: string
          id?: string
          match_method?: string | null
          settlement_record_id?: string | null
          transaction_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reconciliation_events_settlement_record_id_fkey"
            columns: ["settlement_record_id"]
            isOneToOne: false
            referencedRelation: "settlement_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reconciliation_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      settlement_records: {
        Row: {
          batch_id: string | null
          created_at: string
          currency: string
          dataset_id: string | null
          fee_amount_minor: number
          gross_amount_minor: number
          id: string
          match_confidence: number | null
          match_method: string | null
          matched_transaction_id: string | null
          merchant_reference: string | null
          net_amount_minor: number
          processor: string
          processor_transaction_id: string | null
          raw_payload: Json | null
          settlement_date: string
          source_filename: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          currency: string
          dataset_id?: string | null
          fee_amount_minor: number
          gross_amount_minor: number
          id?: string
          match_confidence?: number | null
          match_method?: string | null
          matched_transaction_id?: string | null
          merchant_reference?: string | null
          net_amount_minor: number
          processor: string
          processor_transaction_id?: string | null
          raw_payload?: Json | null
          settlement_date: string
          source_filename?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          currency?: string
          dataset_id?: string | null
          fee_amount_minor?: number
          gross_amount_minor?: number
          id?: string
          match_confidence?: number | null
          match_method?: string | null
          matched_transaction_id?: string | null
          merchant_reference?: string | null
          net_amount_minor?: number
          processor?: string
          processor_transaction_id?: string | null
          raw_payload?: Json | null
          settlement_date?: string
          source_filename?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settlement_records_matched_transaction_id_fkey"
            columns: ["matched_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          capture_date: string | null
          captured_amount_minor: number | null
          created_at: string
          currency: string
          dataset_id: string | null
          expected_settlement_date: string | null
          id: string
          merchant_reference: string | null
          payment_method: string
          processor: string
          reconciliation_status: string
          status: string
          transaction_id: string
        }
        Insert: {
          capture_date?: string | null
          captured_amount_minor?: number | null
          created_at?: string
          currency: string
          dataset_id?: string | null
          expected_settlement_date?: string | null
          id?: string
          merchant_reference?: string | null
          payment_method: string
          processor: string
          reconciliation_status?: string
          status: string
          transaction_id: string
        }
        Update: {
          capture_date?: string | null
          captured_amount_minor?: number | null
          created_at?: string
          currency?: string
          dataset_id?: string | null
          expected_settlement_date?: string | null
          id?: string
          merchant_reference?: string | null
          payment_method?: string
          processor?: string
          reconciliation_status?: string
          status?: string
          transaction_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
