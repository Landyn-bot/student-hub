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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      assignments: {
        Row: {
          ai_confidence: number | null
          ai_generated: boolean
          completed_at: string | null
          course_id: string | null
          created_at: string
          description: string | null
          due_date: string | null
          due_time: string | null
          edited_at: string | null
          edited_by_user: boolean
          id: string
          needs_attention_reason: string | null
          points: number | null
          priority: string
          review_status: string
          source_chunk_key: string | null
          source_document_id: string | null
          source_page: number | null
          source_text: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
          weight: number | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_generated?: boolean
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          edited_at?: string | null
          edited_by_user?: boolean
          id?: string
          needs_attention_reason?: string | null
          points?: number | null
          priority?: string
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_page?: number | null
          source_text?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
          weight?: number | null
        }
        Update: {
          ai_confidence?: number | null
          ai_generated?: boolean
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          due_time?: string | null
          edited_at?: string | null
          edited_by_user?: boolean
          id?: string
          needs_attention_reason?: string | null
          points?: number | null
          priority?: string
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_page?: number | null
          source_text?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "course_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          currency: string
          ends_on: string | null
          id: string
          name: string
          period: string
          starts_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          ends_on?: string | null
          id?: string
          name: string
          period?: string
          starts_on?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          currency?: string
          ends_on?: string | null
          id?: string
          name?: string
          period?: string
          starts_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      calendar_events: {
        Row: {
          ai_confidence: number | null
          ai_generated: boolean
          all_day: boolean
          assignment_id: string | null
          course_id: string | null
          created_at: string
          description: string | null
          edited_at: string | null
          edited_by_user: boolean
          ends_at: string | null
          event_type: string
          exam_id: string | null
          id: string
          location: string | null
          needs_attention_reason: string | null
          recurrence_rule: string | null
          review_status: string
          source_chunk_key: string | null
          source_document_id: string | null
          source_text: string | null
          starts_at: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_generated?: boolean
          all_day?: boolean
          assignment_id?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          edited_at?: string | null
          edited_by_user?: boolean
          ends_at?: string | null
          event_type?: string
          exam_id?: string | null
          id?: string
          location?: string | null
          needs_attention_reason?: string | null
          recurrence_rule?: string | null
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_text?: string | null
          starts_at?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_confidence?: number | null
          ai_generated?: boolean
          all_day?: boolean
          assignment_id?: string | null
          course_id?: string | null
          created_at?: string
          description?: string | null
          edited_at?: string | null
          edited_by_user?: boolean
          ends_at?: string | null
          event_type?: string
          exam_id?: string | null
          id?: string
          location?: string | null
          needs_attention_reason?: string | null
          recurrence_rule?: string | null
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_text?: string | null
          starts_at?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "course_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          course_id: string | null
          created_at: string
          id: string
          last_message_at: string | null
          model: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          model?: string | null
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          model?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          citations: Json | null
          content: string
          conversation_id: string
          created_at: string
          id: string
          model: string | null
          role: string
          source_document_id: string | null
          source_text: string | null
          token_count: number | null
          user_id: string
        }
        Insert: {
          citations?: Json | null
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          model?: string | null
          role: string
          source_document_id?: string | null
          source_text?: string | null
          token_count?: number | null
          user_id: string
        }
        Update: {
          citations?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          model?: string | null
          role?: string
          source_document_id?: string | null
          source_text?: string | null
          token_count?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "course_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      course_documents: {
        Row: {
          course_id: string | null
          created_at: string
          error_message: string | null
          file_type: string | null
          filename: string
          id: string
          page_count: number | null
          processing_status: string
          raw_text: string | null
          storage_path: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          course_id?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          filename: string
          id?: string
          page_count?: number | null
          processing_status?: string
          raw_text?: string | null
          storage_path?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          course_id?: string | null
          created_at?: string
          error_message?: string | null
          file_type?: string | null
          filename?: string
          id?: string
          page_count?: number | null
          processing_status?: string
          raw_text?: string | null
          storage_path?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_documents_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      course_policies: {
        Row: {
          ai_confidence: number | null
          ai_generated: boolean
          content: string | null
          course_id: string | null
          created_at: string
          edited_at: string | null
          edited_by_user: boolean
          id: string
          needs_attention_reason: string | null
          policy_type: string
          review_status: string
          source_chunk_key: string | null
          source_document_id: string | null
          source_page: number | null
          source_text: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_generated?: boolean
          content?: string | null
          course_id?: string | null
          created_at?: string
          edited_at?: string | null
          edited_by_user?: boolean
          id?: string
          needs_attention_reason?: string | null
          policy_type?: string
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_page?: number | null
          source_text?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_confidence?: number | null
          ai_generated?: boolean
          content?: string | null
          course_id?: string | null
          created_at?: string
          edited_at?: string | null
          edited_by_user?: boolean
          id?: string
          needs_attention_reason?: string | null
          policy_type?: string
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_page?: number | null
          source_text?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_policies_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "course_policies_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "course_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          color: string | null
          course_code: string | null
          created_at: string
          credits: number | null
          external_id: string | null
          id: string
          instructor: string | null
          name: string
          source: string
          term_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          course_code?: string | null
          created_at?: string
          credits?: number | null
          external_id?: string | null
          id?: string
          instructor?: string | null
          name: string
          source?: string
          term_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          course_code?: string | null
          created_at?: string
          credits?: number | null
          external_id?: string | null
          id?: string
          instructor?: string | null
          name?: string
          source?: string
          term_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_term_id_fkey"
            columns: ["term_id"]
            isOneToOne: false
            referencedRelation: "terms"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          ai_confidence: number | null
          ai_generated: boolean
          course_id: string | null
          created_at: string
          description: string | null
          edited_at: string | null
          edited_by_user: boolean
          end_time: string | null
          exam_date: string | null
          exam_type: string | null
          id: string
          location: string | null
          needs_attention_reason: string | null
          points: number | null
          review_status: string
          source_chunk_key: string | null
          source_document_id: string | null
          source_text: string | null
          start_time: string | null
          title: string
          updated_at: string
          user_id: string
          weight: number | null
        }
        Insert: {
          ai_confidence?: number | null
          ai_generated?: boolean
          course_id?: string | null
          created_at?: string
          description?: string | null
          edited_at?: string | null
          edited_by_user?: boolean
          end_time?: string | null
          exam_date?: string | null
          exam_type?: string | null
          id?: string
          location?: string | null
          needs_attention_reason?: string | null
          points?: number | null
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_text?: string | null
          start_time?: string | null
          title: string
          updated_at?: string
          user_id: string
          weight?: number | null
        }
        Update: {
          ai_confidence?: number | null
          ai_generated?: boolean
          course_id?: string | null
          created_at?: string
          description?: string | null
          edited_at?: string | null
          edited_by_user?: boolean
          end_time?: string | null
          exam_date?: string | null
          exam_type?: string | null
          id?: string
          location?: string | null
          needs_attention_reason?: string | null
          points?: number | null
          review_status?: string
          source_chunk_key?: string | null
          source_document_id?: string | null
          source_text?: string | null
          start_time?: string | null
          title?: string
          updated_at?: string
          user_id?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exams_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "course_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_transactions: {
        Row: {
          amount: number
          budget_id: string | null
          category: string | null
          course_id: string | null
          created_at: string
          currency: string
          description: string
          direction: string
          id: string
          merchant: string | null
          notes: string | null
          occurred_on: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          budget_id?: string | null
          category?: string | null
          course_id?: string | null
          created_at?: string
          currency?: string
          description: string
          direction?: string
          id?: string
          merchant?: string | null
          notes?: string | null
          occurred_on?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          budget_id?: string | null
          category?: string | null
          course_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          direction?: string
          id?: string
          merchant?: string | null
          notes?: string | null
          occurred_on?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_transactions_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_transactions_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_reminder_hours: number
          email_reminders: boolean
          full_name: string | null
          id: string
          onboarding_completed_at: string | null
          planning_style: string
          school: string | null
          updated_at: string
          week_starts_on: number
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_reminder_hours?: number
          email_reminders?: boolean
          full_name?: string | null
          id: string
          onboarding_completed_at?: string | null
          planning_style?: string
          school?: string | null
          updated_at?: string
          week_starts_on?: number
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_reminder_hours?: number
          email_reminders?: boolean
          full_name?: string | null
          id?: string
          onboarding_completed_at?: string | null
          planning_style?: string
          school?: string | null
          updated_at?: string
          week_starts_on?: number
        }
        Relationships: []
      }
      tasks: {
        Row: {
          ai_generated: boolean
          assignment_id: string | null
          completed_at: string | null
          course_id: string | null
          created_at: string
          due_date: string | null
          due_time: string | null
          id: string
          notes: string | null
          priority: string
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_generated?: boolean
          assignment_id?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          due_date?: string | null
          due_time?: string | null
          id?: string
          notes?: string | null
          priority?: string
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_generated?: boolean
          assignment_id?: string | null
          completed_at?: string | null
          course_id?: string | null
          created_at?: string
          due_date?: string | null
          due_time?: string | null
          id?: string
          notes?: string | null
          priority?: string
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
        ]
      }
      terms: {
        Row: {
          created_at: string
          ends_on: string | null
          id: string
          is_current: boolean
          name: string
          starts_on: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ends_on?: string | null
          id?: string
          is_current?: boolean
          name: string
          starts_on?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          ends_on?: string | null
          id?: string
          is_current?: boolean
          name?: string
          starts_on?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_onboarding: {
        Args: {
          _default_reminder_hours: number
          _email_reminders?: boolean
          _ends_on: string
          _planning_style: string
          _school: string
          _starts_on: string
          _term_name: string
          _week_starts_on: number
        }
        Returns: undefined
      }
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
