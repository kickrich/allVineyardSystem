module Api
  module V1
    class DroneLogsController < BaseController
      def index
        logs = @current_user.drone_logs.includes(:drone).recent_first
        logs = logs.where(drone_id: params[:drone_id]) if params[:drone_id].present?

        render_data(logs.map { |log| serialize_log(log) })
      end

      def create
        log = @current_user.drone_logs.new(drone_log_params)
        log.logged_at ||= Time.current

        if log.save
          render_data(serialize_log(log), status: :created)
        else
          render_errors(log.errors.full_messages, status: :unprocessable_entity)
        end
      end

      private

      def drone_log_params
        params.require(:drone_log).permit(:drone_id, :message, :logged_at, data: {})
      end

      def serialize_log(log)
        {
          id: log.id,
          drone_id: log.drone_id,
          drone_name: log.drone&.name,
          message: log.message,
          data: log.data || {},
          logged_at: log.logged_at
        }
      end
    end
  end
end
