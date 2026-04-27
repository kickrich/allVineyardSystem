# app/assets/builds/tailwind.css is gitignored; Propshaft raises if it is missing.
# Compile once on boot in development when the file does not exist yet.
if Rails.env.development?
  tw_build = Rails.root.join("app/assets/builds/tailwind.css")
  unless tw_build.file?
    require "tailwindcss/commands"
    FileUtils.mkdir_p(Rails.root.join("app/assets/builds"))
    cmd = Tailwindcss::Commands.compile_command(debug: true)
    env = Tailwindcss::Commands.command_env(verbose: false)
    unless system(env, *cmd, exception: false)
      warn "[tailwindcss-rails] Could not compile #{tw_build.relative_path_from(Rails.root)}. Run: bin/rails tailwindcss:build"
    end
  end
end
