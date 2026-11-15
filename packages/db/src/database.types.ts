export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      chat_sources: {
        Row: {
          chat_id: string;
          created_at: string;
          notebook_id: string;
          source_id: string;
          user_id: string;
        };
        Insert: {
          chat_id: string;
          created_at?: string;
          notebook_id: string;
          source_id: string;
          user_id?: string;
        };
        Update: {
          chat_id?: string;
          created_at?: string;
          notebook_id?: string;
          source_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chat_sources_chat_fk';
            columns: ['chat_id', 'notebook_id'];
            isOneToOne: false;
            referencedRelation: 'chats';
            referencedColumns: ['id', 'notebook_id'];
          },
          {
            foreignKeyName: 'chat_sources_notebook_fk';
            columns: ['notebook_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'chat_sources_source_fk';
            columns: ['source_id', 'notebook_id'];
            isOneToOne: false;
            referencedRelation: 'sources';
            referencedColumns: ['id', 'notebook_id'];
          },
        ];
      };
      chats: {
        Row: {
          created_at: string;
          id: string;
          notebook_id: string;
          title: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          notebook_id: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          notebook_id?: string;
          title?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'chats_notebook_fk';
            columns: ['notebook_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      messages: {
        Row: {
          chat_id: string;
          citations: Json;
          content: string;
          created_at: string;
          id: string;
          model: string | null;
          parts: Json | null;
          role: string;
          usage: Json | null;
          user_id: string;
        };
        Insert: {
          chat_id: string;
          citations?: Json;
          content: string;
          created_at?: string;
          id?: string;
          model?: string | null;
          parts?: Json | null;
          role: string;
          usage?: Json | null;
          user_id?: string;
        };
        Update: {
          chat_id?: string;
          citations?: Json;
          content?: string;
          created_at?: string;
          id?: string;
          model?: string | null;
          parts?: Json | null;
          role?: string;
          usage?: Json | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'messages_chat_fk';
            columns: ['chat_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'chats';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      notebooks: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          language: string;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          language: string;
          name: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          language?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      podcast_sources: {
        Row: {
          created_at: string;
          notebook_id: string;
          podcast_id: string;
          source_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          notebook_id: string;
          podcast_id: string;
          source_id: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          notebook_id?: string;
          podcast_id?: string;
          source_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'podcast_sources_notebook_fk';
            columns: ['notebook_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id', 'user_id'];
          },
          {
            foreignKeyName: 'podcast_sources_podcast_fk';
            columns: ['podcast_id', 'notebook_id'];
            isOneToOne: false;
            referencedRelation: 'podcasts';
            referencedColumns: ['id', 'notebook_id'];
          },
          {
            foreignKeyName: 'podcast_sources_source_fk';
            columns: ['source_id', 'notebook_id'];
            isOneToOne: false;
            referencedRelation: 'sources';
            referencedColumns: ['id', 'notebook_id'];
          },
        ];
      };
      podcasts: {
        Row: {
          created_at: string;
          duration_seconds: number | null;
          error: string | null;
          id: string;
          language: string;
          mode: string;
          notebook_id: string;
          script: Json | null;
          status: string;
          storage_path: string | null;
          target_minutes: number;
          title: string | null;
          topic: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          duration_seconds?: number | null;
          error?: string | null;
          id?: string;
          language: string;
          mode: string;
          notebook_id: string;
          script?: Json | null;
          status?: string;
          storage_path?: string | null;
          target_minutes: number;
          title?: string | null;
          topic: string;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          duration_seconds?: number | null;
          error?: string | null;
          id?: string;
          language?: string;
          mode?: string;
          notebook_id?: string;
          script?: Json | null;
          status?: string;
          storage_path?: string | null;
          target_minutes?: number;
          title?: string | null;
          topic?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'podcasts_notebook_fk';
            columns: ['notebook_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
      sources: {
        Row: {
          created_at: string;
          error: string | null;
          id: string;
          kind: string;
          mime_type: string | null;
          notebook_id: string;
          original_url: string | null;
          page_count: number | null;
          size_bytes: number | null;
          status: string;
          storage_path: string | null;
          title: string;
          token_count: number | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          error?: string | null;
          id?: string;
          kind: string;
          mime_type?: string | null;
          notebook_id: string;
          original_url?: string | null;
          page_count?: number | null;
          size_bytes?: number | null;
          status?: string;
          storage_path?: string | null;
          title: string;
          token_count?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          id?: string;
          kind?: string;
          mime_type?: string | null;
          notebook_id?: string;
          original_url?: string | null;
          page_count?: number | null;
          size_bytes?: number | null;
          status?: string;
          storage_path?: string | null;
          title?: string;
          token_count?: number | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sources_notebook_fk';
            columns: ['notebook_id', 'user_id'];
            isOneToOne: false;
            referencedRelation: 'notebooks';
            referencedColumns: ['id', 'user_id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      language_regconfig: { Args: { code: string }; Returns: unknown };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
