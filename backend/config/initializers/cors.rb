Rails.application.config.middleware.insert_before 0, Rack::Cors do
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
end