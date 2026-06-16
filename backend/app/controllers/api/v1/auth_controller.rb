module Api
  module V1
    class AuthController < ApplicationController
      # POST /api/v1/auth/login
      # Простой вход по email/password, возвращает JWT.
      def login
        user = User.find_by(email: login_params[:email].to_s.strip.downcase)

        if user&.authenticate(login_params[:password].to_s)
          token = encode_token({ user_id: user.id })
          render_data({ token: token, user: user_payload(user) })
        else
          render_errors(I18n.t("api.auth.errors.invalid_credentials", default: "Неверный email или пароль"), status: :unauthorized)
        end
      end

      private

      # Параметры входа
      def login_params
        params.permit(:email, :password)
      end
          
      def user_payload(user)
        user.as_json(except: :password_digest)
      end
    end
  end
end
