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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      accounts: {
        Row: {
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      activity_log: {
        Row: {
          action: string
          client_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          client_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_state: {
        Row: {
          detail: Json | null
          key: string
          notified_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          detail?: Json | null
          key: string
          notified_at?: string | null
          state: string
          updated_at?: string
        }
        Update: {
          detail?: Json | null
          key?: string
          notified_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: string
          after: Json | null
          approval_id: string | null
          before: Json | null
          client_id: string | null
          entity_id: string | null
          entity_type: string
          id: string
          occurred_at: string
          request_ip: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: string
          after?: Json | null
          approval_id?: string | null
          before?: Json | null
          client_id?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          occurred_at?: string
          request_ip?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: string
          after?: Json | null
          approval_id?: string | null
          before?: Json | null
          client_id?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          occurred_at?: string
          request_ip?: string | null
        }
        Relationships: []
      }
      audits: {
        Row: {
          audit_date: string
          audit_report_url: string | null
          created_at: string
          findings_count: number | null
          id: string
          project_id: string
        }
        Insert: {
          audit_date?: string
          audit_report_url?: string | null
          created_at?: string
          findings_count?: number | null
          id?: string
          project_id: string
        }
        Update: {
          audit_date?: string
          audit_report_url?: string | null
          created_at?: string
          findings_count?: number | null
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audits_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      business_calendar: {
        Row: {
          id: boolean
          time_zone: string
          updated_at: string
          updated_by: string | null
          working_days: number[]
        }
        Insert: {
          id?: boolean
          time_zone?: string
          updated_at?: string
          updated_by?: string | null
          working_days?: number[]
        }
        Update: {
          id?: boolean
          time_zone?: string
          updated_at?: string
          updated_by?: string | null
          working_days?: number[]
        }
        Relationships: []
      }
      business_holidays: {
        Row: {
          created_at: string
          created_by: string | null
          holiday_date: string
          label: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          holiday_date: string
          label: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          holiday_date?: string
          label?: string
        }
        Relationships: []
      }
      business_profile: {
        Row: {
          contact_email: string | null
          display_name: string | null
          id: boolean
          legal_name: string
          mailing_address: string | null
          phone: string | null
          updated_at: string
          updated_by: string | null
          website_url: string | null
        }
        Insert: {
          contact_email?: string | null
          display_name?: string | null
          id?: boolean
          legal_name: string
          mailing_address?: string | null
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          website_url?: string | null
        }
        Update: {
          contact_email?: string | null
          display_name?: string | null
          id?: boolean
          legal_name?: string
          mailing_address?: string | null
          phone?: string | null
          updated_at?: string
          updated_by?: string | null
          website_url?: string | null
        }
        Relationships: []
      }
      billing_actions: {
        Row: {
          action_key: string
          client_id: string
          completed_at: string | null
          completed_by: string | null
          created_at: string
          cycle_id: string
          due_on: string
          id: string
          milestone: string
          outcome: string | null
          status: string
          updated_at: string
          work_item_id: string | null
        }
        Insert: {
          action_key: string
          client_id: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          cycle_id: string
          due_on: string
          id?: string
          milestone: string
          outcome?: string | null
          status?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Update: {
          action_key?: string
          client_id?: string
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          cycle_id?: string
          due_on?: string
          id?: string
          milestone?: string
          outcome?: string | null
          status?: string
          updated_at?: string
          work_item_id?: string | null
        }
        Relationships: []
      }
      billing_cycles: {
        Row: {
          agreement_id: string
          amount_cents: number
          cancelled_reason: string | null
          client_id: string
          created_at: string
          due_on: string
          id: string
          invoice_sender: string
          invoice_sent_at: string | null
          invoice_sent_by: string | null
          invoice_url: string | null
          manual_amount_cents: number | null
          manual_method: string | null
          manual_note: string | null
          manual_recorded_at: string | null
          manual_recorded_by: string | null
          paid_at: string | null
          payment_ref: string | null
          plan_name: string | null
          reminder_sent_at: string | null
          reminder_sent_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agreement_id: string
          amount_cents: number
          cancelled_reason?: string | null
          client_id: string
          created_at?: string
          due_on: string
          id?: string
          invoice_sender: string
          invoice_sent_at?: string | null
          invoice_sent_by?: string | null
          invoice_url?: string | null
          manual_amount_cents?: number | null
          manual_method?: string | null
          manual_note?: string | null
          manual_recorded_at?: string | null
          manual_recorded_by?: string | null
          paid_at?: string | null
          payment_ref?: string | null
          plan_name?: string | null
          reminder_sent_at?: string | null
          reminder_sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agreement_id?: string
          amount_cents?: number
          cancelled_reason?: string | null
          client_id?: string
          created_at?: string
          due_on?: string
          id?: string
          invoice_sender?: string
          invoice_sent_at?: string | null
          invoice_sent_by?: string | null
          invoice_url?: string | null
          manual_amount_cents?: number | null
          manual_method?: string | null
          manual_note?: string | null
          manual_recorded_at?: string | null
          manual_recorded_by?: string | null
          paid_at?: string | null
          payment_ref?: string | null
          plan_name?: string | null
          reminder_sent_at?: string | null
          reminder_sent_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      care_agreements: {
        Row: {
          anniversary_day: number
          cancelled_at: string | null
          client_id: string
          created_at: string
          id: string
          invoice_sender: string
          monthly_price_cents: number
          paused_at: string | null
          payment_link_url: string | null
          plan_name: string | null
          starts_on: string
          status: string
          tasks_from: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          anniversary_day: number
          cancelled_at?: string | null
          client_id: string
          created_at?: string
          id?: string
          invoice_sender?: string
          monthly_price_cents: number
          paused_at?: string | null
          payment_link_url?: string | null
          plan_name?: string | null
          starts_on: string
          status?: string
          tasks_from?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          anniversary_day?: number
          cancelled_at?: string | null
          client_id?: string
          created_at?: string
          id?: string
          invoice_sender?: string
          monthly_price_cents?: number
          paused_at?: string | null
          payment_link_url?: string | null
          plan_name?: string | null
          starts_on?: string
          status?: string
          tasks_from?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      care_plan_templates: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          included_services: string[]
          monthly_price_cents: number
          name: string
          priority_support: boolean
          response_target_business_days: number
          small_updates_per_cycle: number
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          included_services?: string[]
          monthly_price_cents: number
          name: string
          priority_support?: boolean
          response_target_business_days: number
          small_updates_per_cycle: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          included_services?: string[]
          monthly_price_cents?: number
          name?: string
          priority_support?: boolean
          response_target_business_days?: number
          small_updates_per_cycle?: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      catalog_items: {
        Row: {
          active: boolean
          code: string
          created_at: string
          description: string | null
          id: string
          internal_benchmark_cents: number | null
          kind: string
          name: string
          percent_value: number | null
          price_cents: number | null
          pricing_model: string
          sort_order: number
          updated_at: string
          updated_by: string | null
          watch_pricing: boolean
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          description?: string | null
          id?: string
          internal_benchmark_cents?: number | null
          kind: string
          name: string
          percent_value?: number | null
          price_cents?: number | null
          pricing_model: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          watch_pricing?: boolean
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          description?: string | null
          id?: string
          internal_benchmark_cents?: number | null
          kind?: string
          name?: string
          percent_value?: number | null
          price_cents?: number | null
          pricing_model?: string
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
          watch_pricing?: boolean
        }
        Relationships: []
      }
      client_documents: {
        Row: {
          category: string | null
          client_id: string
          client_visible: boolean
          created_at: string
          file_name: string
          file_path: string
          id: string
          kind: string | null
        }
        Insert: {
          category?: string | null
          client_id: string
          client_visible?: boolean
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          kind?: string | null
        }
        Update: {
          category?: string | null
          client_id?: string
          client_visible?: boolean
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          kind?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_emails: {
        Row: {
          client_id: string
          created_at: string
          email: string
          id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          email: string
          id?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          email?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_notes: {
        Row: {
          client_id: string
          content: string
          created_at: string
          id: string
        }
        Insert: {
          client_id: string
          content: string
          created_at?: string
          id?: string
        }
        Update: {
          client_id?: string
          content?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_notes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_phones: {
        Row: {
          client_id: string
          created_at: string
          id: string
          phone: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          phone: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_phones_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_users: {
        Row: {
          auth_user_id: string
          client_id: string
          created_at: string
          id: string
          is_primary: boolean
        }
        Insert: {
          auth_user_id: string
          client_id: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Update: {
          auth_user_id?: string
          client_id?: string
          created_at?: string
          id?: string
          is_primary?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "client_users_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      client_websites: {
        Row: {
          client_id: string
          created_at: string
          id: string
          label: string
          url: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          label?: string
          url: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          label?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_websites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          account_id: string | null
          archived_at: string | null
          billing_anchor_date: string | null
          business_name: string
          client_since: string | null
          contact_name: string
          created_at: string
          email: string
          id: string
          lifetime_value: number
          logo_path: string | null
          monitoring_paused_at: string | null
          on_hold_since: string | null
          phone: string | null
          plan_name: string | null
          revision_usage_current_cycle: number
          revisions_included: number
          status: string
          stripe_customer_id: string | null
          subscription_price: number
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          archived_at?: string | null
          billing_anchor_date?: string | null
          business_name: string
          client_since?: string | null
          contact_name: string
          created_at?: string
          email: string
          id?: string
          lifetime_value?: number
          logo_path?: string | null
          monitoring_paused_at?: string | null
          on_hold_since?: string | null
          phone?: string | null
          plan_name?: string | null
          revision_usage_current_cycle?: number
          revisions_included?: number
          status?: string
          stripe_customer_id?: string | null
          subscription_price?: number
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          archived_at?: string | null
          billing_anchor_date?: string | null
          business_name?: string
          client_since?: string | null
          contact_name?: string
          created_at?: string
          email?: string
          id?: string
          lifetime_value?: number
          logo_path?: string | null
          monitoring_paused_at?: string | null
          on_hold_since?: string | null
          phone?: string | null
          plan_name?: string | null
          revision_usage_current_cycle?: number
          revisions_included?: number
          status?: string
          stripe_customer_id?: string | null
          subscription_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string
          expense_date: string
          id: string
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          description: string
          expense_date?: string
          id?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string
          expense_date?: string
          id?: string
        }
        Relationships: []
      }
      internal_work_items: {
        Row: {
          account_id: string | null
          client_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          id: string
          priority: string
          project_id: string | null
          source: string
          source_reference: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          account_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string | null
          source: string
          source_reference?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          account_id?: string | null
          client_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          id?: string
          priority?: string
          project_id?: string | null
          source?: string
          source_reference?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_work_items_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_work_items_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "internal_work_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          attempts: number
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string
          job_key: string
          result: Json | null
          started_at: string
          status: string
          trigger_source: string
        }
        Insert: {
          attempts?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key: string
          job_key: string
          result?: Json | null
          started_at?: string
          status?: string
          trigger_source?: string
        }
        Update: {
          attempts?: number
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          job_key?: string
          result?: Json | null
          started_at?: string
          status?: string
          trigger_source?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_job_key_fkey"
            columns: ["job_key"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["key"]
          },
        ]
      }
      jobs: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          interval_minutes: number
          key: string
          last_run_at: string | null
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          interval_minutes: number
          key: string
          last_run_at?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          interval_minutes?: number
          key?: string
          last_run_at?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          business_name: string
          created_at: string
          email: string | null
          estimated_value: number | null
          follow_up_date: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_name: string
          created_at?: string
          email?: string | null
          estimated_value?: number | null
          follow_up_date?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_name?: string
          created_at?: string
          email?: string | null
          estimated_value?: number | null
          follow_up_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      notes: {
        Row: {
          content: string
          id: number
          updated_at: string
        }
        Insert: {
          content?: string
          id?: number
          updated_at?: string
        }
        Update: {
          content?: string
          id?: number
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          client_id: string | null
          created_at: string
          id: string
          read: boolean
          request_id: string | null
          type: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          id?: string
          read?: boolean
          request_id?: string | null
          type?: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          id?: string
          read?: boolean
          request_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          id: string
          role: string
        }
        Insert: {
          created_at?: string | null
          id: string
          role: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
        }
        Relationships: []
      }
      project_services: {
        Row: {
          account_label: string | null
          category: string
          created_at: string
          id: string
          notes: string | null
          project_id: string
          provider: string
          reference: string | null
          updated_at: string
        }
        Insert: {
          account_label?: string | null
          category: string
          created_at?: string
          id?: string
          notes?: string | null
          project_id: string
          provider: string
          reference?: string | null
          updated_at?: string
        }
        Update: {
          account_label?: string | null
          category?: string
          created_at?: string
          id?: string
          notes?: string | null
          project_id?: string
          provider?: string
          reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_services_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          blocker_note: string | null
          build_value: number | null
          client_id: string | null
          cms: string | null
          contract_pdf_path: string | null
          contract_status: string
          contract_uploaded_at: string | null
          created_at: string
          framework: string | null
          github_url: string | null
          hosting_platform: string
          id: string
          last_deployed_at: string | null
          launched_at: string | null
          name: string | null
          production_url: string | null
          sentry_project: string | null
          staging_url: string | null
          supabase_project_id: string | null
          target_date: string | null
          updated_at: string
        }
        Insert: {
          blocker_note?: string | null
          build_value?: number | null
          client_id?: string | null
          cms?: string | null
          contract_pdf_path?: string | null
          contract_status?: string
          contract_uploaded_at?: string | null
          created_at?: string
          framework?: string | null
          github_url?: string | null
          hosting_platform?: string
          id?: string
          last_deployed_at?: string | null
          launched_at?: string | null
          name?: string | null
          production_url?: string | null
          sentry_project?: string | null
          staging_url?: string | null
          supabase_project_id?: string | null
          target_date?: string | null
          updated_at?: string
        }
        Update: {
          blocker_note?: string | null
          build_value?: number | null
          client_id?: string | null
          cms?: string | null
          contract_pdf_path?: string | null
          contract_status?: string
          contract_uploaded_at?: string | null
          created_at?: string
          framework?: string | null
          github_url?: string | null
          hosting_platform?: string
          id?: string
          last_deployed_at?: string | null
          launched_at?: string | null
          name?: string | null
          production_url?: string | null
          sentry_project?: string | null
          staging_url?: string | null
          supabase_project_id?: string | null
          target_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      push_devices: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          failure_count: number
          id: string
          label: string | null
          last_success_at: string | null
          owner_id: string
          p256dh: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          failure_count?: number
          id?: string
          label?: string | null
          last_success_at?: string | null
          owner_id: string
          p256dh: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          failure_count?: number
          id?: string
          label?: string | null
          last_success_at?: string | null
          owner_id?: string
          p256dh?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string | null
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id?: string | null
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string | null
        }
        Relationships: []
      }
      reports: {
        Row: {
          client_id: string
          generated_at: string
          id: string
          items: Json
          pdf_path: string | null
          period_month: string
          summary: string | null
        }
        Insert: {
          client_id: string
          generated_at?: string
          id?: string
          items?: Json
          pdf_path?: string | null
          period_month: string
          summary?: string | null
        }
        Update: {
          client_id?: string
          generated_at?: string
          id?: string
          items?: Json
          pdf_path?: string | null
          period_month?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reports_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      request_comments: {
        Row: {
          author_type: string
          author_user_id: string | null
          body: string
          client_id: string
          created_at: string
          id: string
          request_id: string
        }
        Insert: {
          author_type: string
          author_user_id?: string | null
          body: string
          client_id: string
          created_at?: string
          id?: string
          request_id: string
        }
        Update: {
          author_type?: string
          author_user_id?: string | null
          body?: string
          client_id?: string
          created_at?: string
          id?: string
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_comments_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_comments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      request_revisions: {
        Row: {
          client_id: string
          created_at: string
          id: string
          notes: string | null
          request_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          notes?: string | null
          request_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "request_revisions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "request_revisions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "requests"
            referencedColumns: ["id"]
          },
        ]
      }
      requests: {
        Row: {
          billable_flag: boolean
          category: string | null
          client_id: string
          completed_at: string | null
          counts_toward_quota: boolean
          created_at: string
          description: string | null
          display_id: string
          estimated_charge: number
          id: string
          priority: string | null
          source: string | null
          website_url: string | null
          revision_count: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          billable_flag?: boolean
          category?: string | null
          client_id: string
          completed_at?: string | null
          counts_toward_quota?: boolean
          created_at?: string
          description?: string | null
          display_id: string
          estimated_charge?: number
          id?: string
          priority?: string | null
          source?: string | null
          website_url?: string | null
          revision_count?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          billable_flag?: boolean
          category?: string | null
          client_id?: string
          completed_at?: string | null
          counts_toward_quota?: boolean
          created_at?: string
          description?: string | null
          display_id?: string
          estimated_charge?: number
          id?: string
          priority?: string | null
          source?: string | null
          website_url?: string | null
          revision_count?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requests_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_events: {
        Row: {
          amount: number
          client_id: string | null
          created_at: string
          event_type: string
          id: string
          paid_at: string | null
          status: string
          stripe_invoice_id: string | null
        }
        Insert: {
          amount: number
          client_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          paid_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
        }
        Update: {
          amount?: number
          client_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          paid_at?: string | null
          status?: string
          stripe_invoice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "revenue_events_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      security_findings: {
        Row: {
          category: string
          client_id: string
          code: string
          detail: string | null
          first_seen_at: string
          id: string
          last_seen_at: string
          project_id: string
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          category: string
          client_id: string
          code: string
          detail?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          project_id: string
          resolved_at?: string | null
          severity: string
          title: string
        }
        Update: {
          category?: string
          client_id?: string
          code?: string
          detail?: string | null
          first_seen_at?: string
          id?: string
          last_seen_at?: string
          project_id?: string
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "security_findings_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_findings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_issues: {
        Row: {
          client_id: string | null
          created_at: string
          culprit: string | null
          event_count: number | null
          first_seen: string | null
          id: string
          last_seen: string | null
          level: string | null
          project_id: string | null
          resolved_at: string | null
          sentry_issue_id: string
          sentry_project: string
          short_id: string | null
          status: string
          title: string
          updated_at: string
          user_count: number | null
          web_url: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          culprit?: string | null
          event_count?: number | null
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          level?: string | null
          project_id?: string | null
          resolved_at?: string | null
          sentry_issue_id: string
          sentry_project: string
          short_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_count?: number | null
          web_url?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          culprit?: string | null
          event_count?: number | null
          first_seen?: string | null
          id?: string
          last_seen?: string | null
          level?: string | null
          project_id?: string | null
          resolved_at?: string | null
          sentry_issue_id?: string
          sentry_project?: string
          short_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_count?: number | null
          web_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_issues_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "site_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_monitor_checks: {
        Row: {
          checked_at: string
          client_id: string
          id: string
          response_time_ms: number | null
          security_score: number | null
          status: string
        }
        Insert: {
          checked_at?: string
          client_id: string
          id?: string
          response_time_ms?: number | null
          security_score?: number | null
          status: string
        }
        Update: {
          checked_at?: string
          client_id?: string
          id?: string
          response_time_ms?: number | null
          security_score?: number | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_monitor_checks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      site_monitors: {
        Row: {
          broken_links_count: number | null
          client_id: string
          created_at: string
          domain_expires_at: string | null
          http_status: number | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          response_time_ms: number | null
          security_issues: Json
          security_score: number | null
          ssl_expires_at: string | null
          status: string
          updated_at: string
          url: string
        }
        Insert: {
          broken_links_count?: number | null
          client_id: string
          created_at?: string
          domain_expires_at?: string | null
          http_status?: number | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          response_time_ms?: number | null
          security_issues?: Json
          security_score?: number | null
          ssl_expires_at?: string | null
          status?: string
          updated_at?: string
          url: string
        }
        Update: {
          broken_links_count?: number | null
          client_id?: string
          created_at?: string
          domain_expires_at?: string | null
          http_status?: number | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          response_time_ms?: number | null
          security_issues?: Json
          security_score?: number | null
          ssl_expires_at?: string | null
          status?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_monitors_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      site_visual_checks: {
        Row: {
          client_id: string
          cls: number | null
          created_at: string
          diff_percent: number | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          lcp_ms: number | null
          performance_score: number | null
          screenshot_path: string | null
          tbt_ms: number | null
          updated_at: string
          url: string
        }
        Insert: {
          client_id: string
          cls?: number | null
          created_at?: string
          diff_percent?: number | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          lcp_ms?: number | null
          performance_score?: number | null
          screenshot_path?: string | null
          tbt_ms?: number | null
          updated_at?: string
          url: string
        }
        Update: {
          client_id?: string
          cls?: number | null
          created_at?: string
          diff_percent?: number | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          lcp_ms?: number | null
          performance_score?: number | null
          screenshot_path?: string | null
          tbt_ms?: number | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_visual_checks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount: number
          category: string
          color: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          amount: number
          category: string
          color?: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          amount?: number
          category?: string
          color?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      sync_log: {
        Row: {
          created_at: string | null
          detail: string | null
          event_type: string
          id: string
          outcome: string
          source: string
        }
        Insert: {
          created_at?: string | null
          detail?: string | null
          event_type: string
          id?: string
          outcome: string
          source: string
        }
        Update: {
          created_at?: string | null
          detail?: string | null
          event_type?: string
          id?: string
          outcome?: string
          source?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_client_id: { Args: never; Returns: string }
      next_request_display_id: { Args: never; Returns: string }
      user_role: { Args: never; Returns: string }
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
