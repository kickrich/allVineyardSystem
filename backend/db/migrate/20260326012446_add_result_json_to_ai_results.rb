class AddResultJsonToAiResults < ActiveRecord::Migration[8.1]
  def change
    add_column :ai_results, :result_json, :jsonb
  end
end
