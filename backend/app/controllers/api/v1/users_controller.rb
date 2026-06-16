# app/controllers/api/v1/users_controller.rb

module Api
  module V1
    class UsersController < BaseController
      # Разрешаем создание первого/новых пользователей без токена.
      skip_before_action :authenticate_request!, only: [:create]
      before_action :set_user, only: [:show, :update, :destroy]

      # GET /api/v1/users — список по имени
      def index
        render_data(User.ordered_by_name.as_json(except: :password_digest))
      end

      def show
        render_data(@user.as_json(except: :password_digest))
      end

      # Создание пользователя POST /api/v1/users
      def create
        @user = User.new(user_params)
        if @user.save
          render_message_data(
            "api.users.created",
            @user.as_json(except: :password_digest),
            status: :created,
            default_message: "Пользователь создан"
          )
        else
          render_errors(@user.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Обновление пользователя PUT /api/v1/users/:id
      def update
        if @user.update(user_params)
          render_message_data(
            "api.users.updated",
            @user.as_json(except: :password_digest),
            status: :ok,
            default_message: "Пользователь обновлён"
          )
        else
          render_errors(@user.errors.full_messages, status: :unprocessable_entity)
        end
      end

      # Удаление пользователя DELETE /api/v1/users/:id
      def destroy
        if @user.destroy
          head :no_content
        else
          render_errors(@user.errors.full_messages, status: :unprocessable_entity)
        end
      end

      private

      # Поиск пользователя в базе данных
      def set_user
        @user = User.find(params[:id])
      end
        
      def user_params
        params.require(:user).permit(:name, :email, :password, :password_confirmation)
      end
    end
  end
end