require_relative "boot"
require_relative "preload/windows_skip_vips_analyzer" if Gem.win_platform?

require "rails/all"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module Drones
  class Application < Rails::Application
    # Puma logs harmless "SIG* not implemented" lines on Windows; hide them only there.
    if Gem.win_platform?
      config.before_configuration do
        require "puma/launcher"
        Puma::Launcher.prepend(Module.new do
          def log(str)
            s = str.to_s
            return if s.match?(/\A\*\*\* SIG.+not implemented/)

            super(s)
          end
        end)
      rescue LoadError
        # puma not in bundle (e.g. some rake-only contexts)
      end
    end

    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 8.1

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # Only loads a smaller set of middleware suitable for API only apps.
    # Middleware like session, flash, cookies can be added back manually.
    # Skip views, helpers and assets when generating a new resource.
    config.api_only = true

    # CORS: переопределяется в config/environments/*.rb
    config.allowed_cors_origins = []
  end
end
