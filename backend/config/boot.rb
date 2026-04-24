ENV["BUNDLE_GEMFILE"] ||= File.expand_path("../Gemfile", __dir__)

require "bundler/setup" # Set up gems listed in the Gemfile.
require "bootsnap/setup" # Speed up boot time by caching expensive operations.

# Puma: one fewer failed SIGUSR2 trap on Windows (see puma/launcher.rb).
ENV["PUMA_SKIP_SIGUSR2"] = "1" if Gem.win_platform?
