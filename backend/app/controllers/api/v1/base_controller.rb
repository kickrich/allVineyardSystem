module Api
  module V1
    class BaseController < ApplicationController
      before_action :authenticate_request!

      private
      
      # Аутентификация запроса
      def authenticate_request!
        payload = decoded_token
        return render_errors(I18n.t("api.auth.errors.unauthorized", default: "Требуется авторизация"), status: :unauthorized) if payload.nil?

        @current_user = User.find_by(id: payload["user_id"])
        return if @current_user.present?

        render_errors(I18n.t("api.auth.errors.unauthorized", default: "Требуется авторизация"), status: :unauthorized)
      end
    end
  end
end
