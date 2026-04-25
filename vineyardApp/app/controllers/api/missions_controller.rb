class Api::MissionsController < ApplicationController
  protect_from_forgery with: :null_session

  def create
    mission_id = params[:mission_id].to_s.presence
    row_index = positive_int_or_nil(params[:row_index])
    rows_count = positive_int_or_nil(params[:rows_count])
    external_service_url = params[:external_service_url] || params[:callback_url]
    external_callback_token = params[:external_callback_token] || params[:callback_token]
    name = params[:name] || "Миссия #{mission_id} - #{Time.current.strftime('%Y-%m-%d %H:%M')}"

    unless mission_id.present?
      return render json: {
        error: "mission_id обязателен"
      }, status: :unprocessable_entity
    end

    existing_scope = Video.where(mission_id: mission_id)
    existing_scope = existing_scope.where(row_index: row_index) if row_index.present?
    if existing_scope.exists?
      video = existing_scope.order(created_at: :desc).first
      return render json: {
        id: video.id,
        video_id: video.id,
        mission_id: video.mission_id,
        row_index: video.row_index,
        rows_count: video.rows_count,
        name: video.name,
        status: video.status,
        message: "Видео уже существует"
      }, status: :ok
    end

    video = Video.new(
      mission_id: mission_id,
      row_index: row_index,
      rows_count: rows_count,
      external_service_url: external_service_url,
      external_callback_token: external_callback_token,
      name: name,
      status: :uploading
    )

    if video.save
      render json: {
        id: video.id,
        video_id: video.id,
        mission_id: video.mission_id,
        row_index: video.row_index,
        rows_count: video.rows_count,
        name: video.name,
        status: video.status,
        message: "Видео создано, можно загружать шарды"
      }, status: :created
    else
      render json: { error: video.errors.full_messages }, status: :unprocessable_entity
    end
  end

  def upload_shard
    mission_id = params[:mission_id].to_s.presence
    video_id_param = params[:video_id].presence
    shard_index = params[:shard_index].to_i
    shard_index = 1 if shard_index <= 0
    callback_token = params[:callback_token].to_s.presence
    row_index = positive_int_or_nil(params[:row_index])
    rows_count = positive_int_or_nil(params[:rows_count])
    name = params[:name].presence || "Миссия #{mission_id} — #{Time.current.strftime('%Y-%m-%d %H:%M')}"
    external_service_url = params[:external_service_url].presence

    unless mission_id.present?
      return render json: { error: "mission_id обязателен" }, status: :unprocessable_entity
    end

    resolved = resolve_video_for_shard_upload(
      mission_id: mission_id,
      video_id_param: video_id_param,
      callback_token: callback_token,
      row_index: row_index,
      rows_count: rows_count,
      name: name,
      external_service_url: external_service_url
    )

    if resolved[:error]
      return render json: { error: resolved[:error] }, status: resolved[:status] || :unprocessable_entity
    end

    video = resolved[:video]

    object_key = params[:object_key].to_s.presence
    bucket = params[:bucket].to_s.presence
    video_url = params[:video_url].to_s.presence

    if params[:video].blank? && object_key.blank? && video_url.blank?
      return render json: { error: "Нужно передать video файл или object_key/video_url" }, status: :unprocessable_entity
    end

    if video.video_shards.exists?(shard_index: shard_index)
      return render json: { error: "Shard #{shard_index} уже загружен" }, status: :conflict
    end

    source_payload = {}
    source_payload["object_key"] = object_key if object_key.present?
    source_payload["bucket"] = bucket if bucket.present?
    source_payload["video_url"] = video_url if video_url.present?

    shard = video.video_shards.new(
      shard_index: shard_index,
      original_filename: params[:video]&.original_filename || File.basename(object_key || video_url || "video.mp4"),
      result_json: { "source" => source_payload },
      status: :pending
    )

    if shard.save
      if params[:video].present?
        shard.video_file.attach(params[:video])

        unless shard.video_file.attached?
          shard.destroy
          return render json: { error: "Не удалось прикрепить файл" }, status: :unprocessable_entity
        end
      end

      job = ProcessVideoShardJob.perform_later(shard.id)
      shard.update_column(:job_id, job.job_id)

      video.update!(status: :processing) if video.uploading?

      render json: {
        id: shard.id,
        video_id: video.id,
        mission_id: mission_id,
        row_index: video.row_index,
        rows_count: video.rows_count,
        shard_index: shard_index,
        status: shard.status,
        message: "Shard #{shard_index} загружен и поставлен в очередь на обработку"
      }, status: :created
    else
      render json: { error: shard.errors.full_messages }, status: :unprocessable_entity
    end
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.record.errors.full_messages }, status: :unprocessable_entity
  rescue => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def status
    mission_id = params[:mission_id].to_s.presence
    video = Video.find_by(mission_id: mission_id)

    unless video
      return render json: { error: "Видео с этой миссией не найден" }, status: :not_found
    end

    render json: video.aggregated_results, status: :ok
  end

  def results
    mission_id = params[:id]
    video = Video.find_by(mission_id: mission_id)

    unless video
      return render json: { error: "Видео не найден" }, status: :not_found
    end

    token = request.headers['Authorization']&.gsub('Bearer ', '')
    if video.external_callback_token.present?
      unless token.present? && ActiveSupport::SecurityUtils.secure_compare(
        token,
        video.external_callback_token
      )
        return render json: { error: "Неверный токен" }, status: :unauthorized
      end
    end

    detection = video.detection || video.build_detection
    detection.assign_attributes(
      bushes_count: params[:bushes_count] || params[:ai_result]&.dig(:bushes_count),
      gaps_count: params[:gaps_count] || params[:ai_result]&.dig(:gaps_count),
      avg_bush_spacing: params[:avg_bush_spacing] || params[:ai_result]&.dig(:avg_bush_spacing),
      result_json: params
    )

    if detection.save
      render json: {
        success: true,
        message: "Результаты сохранены",
        detection_id: detection.id
      }, status: :ok
    else
      render json: { error: detection.errors.full_messages }, status: :unprocessable_entity
    end
  end

  private

  # Находит Video по video_id + mission_id, иначе — по mission_id (+ row_index), иначе создаёт новое.
  def resolve_video_for_shard_upload(mission_id:, video_id_param:, callback_token:, row_index:, rows_count:, name:, external_service_url:)
    mid = mission_id.to_s

    if video_id_param.present?
      vid = video_id_param.to_i
      if vid.positive?
        v = Video.find_by(id: vid)
        if v
          if v.mission_id.to_s != mid
            return { error: "video_id #{vid} относится к другой миссии", status: :unprocessable_entity }
          end
          err = shard_callback_token_error(v, callback_token)
          return { error: err, status: :unauthorized } if err
          return { video: v }
        end
        # Нет записи с таким id — продолжаем: привяжем к видео миссии или создадим новое
      end
    end

    existing_scope = Video.where(mission_id: mid)
    existing_scope = existing_scope.where(row_index: row_index) if row_index.present?
    existing = existing_scope.order(created_at: :desc).first
    if existing
      err = shard_callback_token_error(existing, callback_token)
      return { error: err, status: :unauthorized } if err
      return { video: existing }
    end

    video = Video.create!(
      mission_id: mid,
      row_index: row_index,
      rows_count: rows_count,
      external_service_url: external_service_url,
      external_callback_token: callback_token,
      name: name,
      status: :uploading
    )
    { video: video }
  rescue ActiveRecord::RecordInvalid => e
    { error: e.record.errors.full_messages.join(", "), status: :unprocessable_entity }
  end

  def shard_callback_token_error(video, callback_token)
    return nil if video.external_callback_token.blank?
    if callback_token.present? && ActiveSupport::SecurityUtils.secure_compare(callback_token, video.external_callback_token)
      nil
    else
      "Неверный токен"
    end
  end

  def positive_int_or_nil(value)
    v = value.to_i
    v.positive? ? v : nil
  end
end
