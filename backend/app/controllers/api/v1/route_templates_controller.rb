module Api
  module V1
    class RouteTemplatesController < BaseController
      before_action :set_route_template, only: %i[show update destroy]

      def index
        render_data(@current_user.route_templates.ordered_recent)
      end

      def show
        render_data(@route_template)
      end

      def create
        route_template = @current_user.route_templates.new(route_template_params)
        if route_template.save
          render_message_data(
            "api.route_templates.created",
            route_template,
            status: :created,
            default_message: "Шаблон маршрута сохранён"
          )
        else
          render_errors(route_template.errors.full_messages, status: :unprocessable_entity)
        end
      end

      def update
        if @route_template.update(route_template_params)
          render_message_data(
            "api.route_templates.updated",
            @route_template,
            status: :ok,
            default_message: "Шаблон маршрута обновлён"
          )
        else
          render_errors(@route_template.errors.full_messages, status: :unprocessable_entity)
        end
      end

      def destroy
        @route_template.destroy
        head :no_content
      end

      private

      def set_route_template
        @route_template = @current_user.route_templates.find(params[:id])
      end

      def route_template_params
        t = params.require(:route_template)
        permitted = t.permit(:name, :zone_id)
        raw_path = t[:path]
        permitted[:path] = raw_path if raw_path.is_a?(Array)
        permitted
      end
    end
  end
end
