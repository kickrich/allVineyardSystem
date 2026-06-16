Rails.application.config.middleware.insert_before 0, Rack::Cors do
  default_origins = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://localhost:8080"
  allowed_origins = if Rails.env.production?
    ENV.fetch("CORS_ORIGINS", ENV.fetch("FRONTEND_ORIGINS", ""))
  else
    ENV.fetch("FRONTEND_ORIGINS", default_origins)
  end
  allowed_origins = allowed_origins.split(",").map(&:strip).reject(&:blank?)

  allow do
    origins(*allowed_origins)

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head]
  end
end