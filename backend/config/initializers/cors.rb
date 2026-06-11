Rails.application.config.middleware.insert_before 0, Rack::Cors do
  raw_origins = [
    ENV["FRONTEND_ORIGINS"],
    ENV["CORS_ORIGINS"],
    Rails.env.development? ? "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000" : nil
  ].compact.join(",")

  allowed_origins = raw_origins
                       .split(",")
                       .map(&:strip)
                       .reject(&:blank?)
                       .uniq

  allow do
    origins(*allowed_origins)

    resource "*",
      headers: :any,
      methods: [:get, :post, :put, :patch, :delete, :options, :head]
  end
end