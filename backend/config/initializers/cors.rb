Rails.application.config.middleware.insert_before 0, Rack::Cors do
  # В development/staging запросы могут идти с [::1], LAN (192.168.*) и при прямом URL на API —
  # жёсткий список origins ломает связку Vite + Rails.
  if Rails.env.production?
    allowed_origins = ENV.fetch("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000")
                         .split(",")
                         .map(&:strip)
                         .reject(&:blank?)

    allow do
      origins(*allowed_origins)

      resource "*",
        headers: :any,
        methods: [:get, :post, :put, :patch, :delete, :options, :head]
    end
  else
    allow do
      origins "*"

      resource "*",
        headers: :any,
        methods: [:get, :post, :put, :patch, :delete, :options, :head]
    end
  end
end
