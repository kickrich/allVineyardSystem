class AddExternalServiceFieldsToVideos < ActiveRecord::Migration[7.1]
  def change
    add_column :videos, :mission_id, :string, comment: "ID миссии от внешнего сервиса"
    add_column :videos, :external_service_url, :string, comment: "URL сервиса для отправки результатов"
    add_column :videos, :external_callback_token, :string, comment: "Токен для безопасности колбэка"
    
    add_index :videos, :mission_id, unique: true
  end
end
