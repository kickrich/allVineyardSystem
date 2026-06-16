#!/usr/bin/env ruby
# Скрипт для быстрого тестирования интеграции Backend ↔ VineyardApp
# Запуск: cd backend && ruby ../test_integration.rb

require_relative 'config/environment'

puts "🔧 Создание тестовых данных для интеграции..."

# Очищаем старые данные
puts "🗑️  Очистка старых данных..."
MediaUpload.destroy_all
Mission.destroy_all
Route.destroy_all
Drone.destroy_all
User.destroy_all
Zone.destroy_all

# Создаём тестовые данные
puts "📍 Создание зоны..."
zone = Zone.create!(
  name: "Test Zone #{Time.current.to_i}",
  boundary: [[45.0, 55.0], [45.1, 55.0], [45.1, 55.1], [45.0, 55.1], [45.0, 55.0]]
)

puts "🚁 Создание дрона..."
drone = Drone.create!(
  name: "Test Drone",
  model: "Test Model",
  battery: 100,
  status: "idle"
)

puts "👤 Создание пользователя..."
user = User.create!(
  name: "Test User",
  email: "test@example.com",
  password: "password123",
  password_confirmation: "password123"
)

puts "🎯 Создание миссии..."
mission = Mission.create!(
  drone: drone,
  user: user,
  zone: zone,
  status: "planned"
)

puts "📍 Добавление точек маршрута..."
mission.routes.create!(
  latitude: 55.05,
  longitude: 45.05,
  altitude: 5,
  sequence_number: 1
)

puts "✅ Одобрение и завершение миссии..."
mission.update!(status: "approved")
mission.update!(status: "in_progress")
mission.update!(status: "completed")
drone.update!(status: "idle")

puts "📦 Создание MediaUpload записи..."
media_upload = MediaUpload.create!(
  mission: mission,
  media_type: "video",
  status: "uploading",
  url: "http://example.com/video.mp4"
)

puts "\n✅ Тестовые данные созданы!"
puts "\n📊 Информация:"
puts "  Mission ID: #{mission.id}"
puts "  MediaUpload ID: #{media_upload.id}"
puts "  VineyardApp Callback Token: #{mission.vineyard_app_callback_token}"
puts "\n📝 Для тестирования используйте:"
puts "  curl -X PUT http://localhost:3001/api/v1/media_uploads/#{media_upload.id} \\"
puts "    -H 'Authorization: Bearer <YOUR_TOKEN>' \\"
puts "    -H 'Content-Type: application/json' \\"
puts "    -d '{\"media_upload\":{\"status\":\"ready\"}}'"
puts "\n🔍 Логи для отслеживания:"
puts "  tail -f log/development.log | grep -E 'VineyardApp|SendVideo'"
