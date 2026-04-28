namespace :mission do
  desc "Check in-progress missions for telemetry timeout"
  task check_connection: :environment do
    lost_timeout_seconds = ENV.fetch("TIMEOUT_SECONDS", Mission::TELEMETRY_TIMEOUT_SECONDS).to_i
    cancel_timeout_seconds = ENV.fetch("CANCEL_TIMEOUT_SECONDS", Mission::LOST_LINK_CANCEL_TIMEOUT_SECONDS).to_i

    Mission.process_connection_timeouts!(
      lost_timeout_seconds: lost_timeout_seconds,
      cancel_timeout_seconds: cancel_timeout_seconds
    )

    puts "Connection check completed. Lost timeout: #{lost_timeout_seconds}s; Cancel timeout: #{cancel_timeout_seconds}s"
  end
end
