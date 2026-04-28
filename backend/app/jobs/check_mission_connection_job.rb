class CheckMissionConnectionJob < ApplicationJob
  queue_as :default

  DEFAULT_LOST_TIMEOUT_SECONDS = Mission::TELEMETRY_TIMEOUT_SECONDS
  DEFAULT_CANCEL_TIMEOUT_SECONDS = Mission::LOST_LINK_CANCEL_TIMEOUT_SECONDS

  def perform(
    lost_timeout_seconds: DEFAULT_LOST_TIMEOUT_SECONDS,
    cancel_timeout_seconds: DEFAULT_CANCEL_TIMEOUT_SECONDS
  )
    Mission.process_connection_timeouts!(
      lost_timeout_seconds: lost_timeout_seconds,
      cancel_timeout_seconds: cancel_timeout_seconds
    )
  end
end
