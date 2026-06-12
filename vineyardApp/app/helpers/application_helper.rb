module ApplicationHelper
  def status_color(status)
    case status.to_s
    when 'uploading'
      'bg-yellow-100 text-yellow-800'
    when 'processing'
      'bg-blue-100 text-blue-800'
    when 'completed'
      'bg-green-100 text-green-800'
    when 'error'
      'bg-red-100 text-red-800'
    else
      'bg-gray-100 text-gray-800'
    end
  end
end