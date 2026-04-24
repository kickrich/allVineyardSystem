class ApplicationController < ActionController::API
  # 1.8 Обработка ошибок — единая точка для API
  rescue_from ActiveRecord::RecordNotFound do
    render_errors(I18n.t("api.errors.record_not_found", default: "Запись не найдена"), status: :not_found)
  end

  rescue_from ActionController::ParameterMissing do |e|
    render_errors(e.message, status: :bad_request)
  end

  private

  def encode_token(payload, exp: 24.hours.from_now)
    JWT.encode(payload.merge(exp: exp.to_i), jwt_secret, "HS256")
  end

  def decoded_token
    token = bearer_token
    return nil if token.blank?

    decoded = JWT.decode(token, jwt_secret, true, { algorithm: "HS256" })
    decoded.first
  rescue JWT::DecodeError, JWT::ExpiredSignature
    nil
  end

  def bearer_token
    auth_header = request.headers["Authorization"].to_s
    return nil unless auth_header.start_with?("Bearer ")

    auth_header.split(" ", 2).last
  end

  def jwt_secret
    Rails.application.secret_key_base
  end

  def truthy_param?(value)
    # Нормализует "1/true/on/yes" и т.п. к булевому значению.
    ActiveModel::Type::Boolean.new.cast(value)
  end

  def render_errors(errors, status:)
    # Всегда отдаём массив ошибок, чтобы фронт парсил единообразно.
    render json: { errors: Array(errors) }, status: status
  end

  def render_data(data, status: :ok)
    render json: { data: data }, status: status
  end

  def render_message_data(message_key, data, status:, default_message: nil)
    message = I18n.t(message_key, default: default_message || message_key)
    render json: { message: message, data: data }, status: status
  end
end
